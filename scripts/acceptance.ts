/**
 * Prototype acceptance suite (§25) and the §23 backup demo paths.
 *
 * Run against a freshly seeded database: npm run db:reset && npm test
 * Every check maps to a numbered requirement so a failure names the clause it
 * breaks, not just an assertion.
 */
import { sql } from '../src/lib/db';
import { SEED_INSTANT, addHours } from '../src/lib/clock';
import { rupees } from '../src/lib/money';
import { computeMatch, previewsForJob, maskName } from '../src/modules/matching';
import {
  unlockQualifiedProfile, creditBalance, reconcileEntitlement,
  raiseReplacement, releaseMaturedHolds, buildPayoutBatch, partnerRewardSummary,
} from '../src/modules/commercial';
import { validateRoleConfig, activeCommercialPolicy } from '../src/modules/configuration';
import { startRegistration, verifyAndBind, grantConsent, completeProfile } from '../src/modules/candidate';

let pass = 0, fail = 0;
const results: { clause: string; name: string; ok: boolean; detail: string }[] = [];

function check(clause: string, name: string, ok: boolean, detail = '') {
  results.push({ clause, name, ok, detail });
  ok ? pass++ : fail++;
}

async function setClock(at: Date) {
  await sql`UPDATE app.demo_clock SET now_at = ${at} WHERE id = 1`;
}

async function main() {
  await setClock(SEED_INSTANT);

  // ---- §25: persisted state -----------------------------------------------
  const [{ n: candN }] = await sql<{ n: string }[]>`SELECT COUNT(*)::text n FROM app.candidate`;
  check('§25', 'Success path runs from persisted data', Number(candN) === 8, `${candN} candidates seeded`);

  // ---- §25 / LEAD-07: unlock idempotency ----------------------------------
  const before = await creditBalance('ENT-001');
  const again = await unlockQualifiedProfile('EMP-001', 'JOB-001', 'CAN-001', 'EU-001');
  const after = await creditBalance('ENT-001');
  check('LEAD-07', 'Re-unlocking the same profile consumes no second credit',
    again.status === 'ALREADY_UNLOCKED' && before.available === after.available,
    `${again.status}, credits ${before.available} -> ${after.available}`);

  const [{ n: dupUnlocks }] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.qualified_lead_unlock
     WHERE employer_id='EMP-001' AND job_id='JOB-001' AND candidate_id='CAN-001'`;
  check('LEAD-05', 'Exactly one unlock row per employer/job/candidate', dupUnlocks === '1', `${dupUnlocks} rows`);

  // ---- §25: ledger reconciliation -----------------------------------------
  for (const ent of ['ENT-001', 'ENT-002', 'ENT-003']) {
    const r = await reconcileEntitlement(ent);
    check('§25', `Credit ledger reconciles for ${ent}`, r.balances && r.unlocksMatchLedger,
      `granted ${r.granted} + purchased ${r.purchased} − unlocks ${r.unlocks} + adj ${r.adjustments} = ${r.closing}`);
  }

  const [ledger] = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(amount_paise),0)::text total FROM app.reward_ledger`;
  const summaries = await partnerRewardSummary();
  const derived = summaries.reduce((a, s) => a + s.inHoldPaise + s.eligiblePaise + s.paidPaise, 0);
  check('§25', 'Reward ledger net equals the sum of partner balances',
    Number(ledger.total) === derived, `ledger ₹${Number(ledger.total) / 100} vs balances ₹${derived / 100}`);

  // ---- MATCH-06 / §25: reproducible explanations --------------------------
  const [stored] = await sql<{
    score: number; explanation: string[]; rule_version: string; inputs_snapshot: Record<string, unknown>;
  }[]>`SELECT score, explanation, rule_version, inputs_snapshot FROM app.match_result
        WHERE candidate_id='CAN-001' AND job_id='JOB-001'`;
  const recomputed = await computeMatch('CAN-001', 'JOB-001');
  check('MATCH-06', 'Match explanation reproduces from stored config and inputs',
    recomputed.score === stored.score &&
    JSON.stringify(recomputed.explanation) === JSON.stringify(stored.explanation),
    `stored ${stored.score} / recomputed ${recomputed.score}, ${stored.rule_version}`);

  // ---- MATCH-08 / TEST-03: assessment gate --------------------------------
  const k = await computeMatch('CAN-006', 'JOB-001');
  check('MATCH-08', 'Below-threshold assessment blocks qualification',
    !k.qualified && k.stageB.reasons.some((r) => r.startsWith('ASSESSMENT_BELOW')),
    k.stageB.reasons.join(', '));

  // ---- LEAD-02: masking ----------------------------------------------------
  check('LEAD-02', 'Preview masks the surname, not the given name',
    maskName('DEMO Aarav Deshmukh') === 'Aarav D.', maskName('DEMO Aarav Deshmukh'));

  const previews = await previewsForJob('JOB-001', 10);
  const leaksContact = previews.some((p) => 'phone' in p || 'email' in p);
  check('LEAD-02', 'Preview payload carries no contact data', !leaksContact,
    `${previews.length} previews, keys: ${Object.keys(previews[0] ?? {}).join(',')}`);

  // ---- LEAD-11: no dilution ------------------------------------------------
  const allQualified = previews.every((p) => p.score !== null);
  check('LEAD-11', 'Preview batch contains only qualified profiles',
    allQualified && previews.length < 10, `${previews.length} shown, none unqualified`);

  // ---- LEAD-03 / MATCH-09: reconfirmation gate ----------------------------
  await sql`UPDATE app.application SET reconfirmed_at = NULL WHERE candidate_id='CAN-004' AND job_id='JOB-001'`;
  const blocked = await unlockQualifiedProfile('EMP-001', 'JOB-001', 'CAN-004', 'EU-001');
  check('MATCH-09', 'Unreconfirmed candidate cannot be unlocked',
    blocked.status === 'BLOCKED' && blocked.reason === 'INTEREST_NOT_RECONFIRMED', String(blocked.reason));
  await sql`UPDATE app.application SET reconfirmed_at = ${SEED_INSTANT} WHERE candidate_id='CAN-004' AND job_id='JOB-001'`;

  // ---- §15: consent withdrawal --------------------------------------------
  const withdrawn = await unlockQualifiedProfile('EMP-001', 'JOB-001', 'CAN-007', 'EU-001');
  check('§15', 'Withdrawn consent blocks a new unlock',
    withdrawn.status === 'BLOCKED', String(withdrawn.reason));
  const [{ n: keptUnlocks }] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.qualified_lead_unlock WHERE status='CONFIRMED'`;
  check('§15', 'Withdrawal does not unwind a completed unlock', Number(keptUnlocks) >= 1,
    `${keptUnlocks} confirmed unlocks retained`);

  // ---- LEAD-08/09: replacement chain --------------------------------------
  const [repl] = await sql<{ id: string; decision: string }[]>`
    SELECT id, decision FROM app.replacement_case ORDER BY raised_at LIMIT 1`;
  check('LEAD-09', 'Seeded replacement case was approved', repl?.decision === 'APPROVED', repl?.decision ?? 'none');

  const [reversal] = await sql<{ id: string; linked_entry_id: string | null; amount_paise: string }[]>`
    SELECT id, linked_entry_id, amount_paise FROM app.reward_ledger WHERE entry_type='REVERSAL' LIMIT 1`;
  check('REF-08', 'Reversal is a new linked row, not an edit',
    !!reversal && !!reversal.linked_entry_id && Number(reversal.amount_paise) < 0,
    `${reversal?.id} links ${reversal?.linked_entry_id} at ₹${Number(reversal?.amount_paise ?? 0) / 100}`);

  const [restore] = await sql<{ credit_delta: number; linked_entry_id: string | null }[]>`
    SELECT credit_delta, linked_entry_id FROM app.credit_ledger WHERE entry_type='REPLACEMENT_RESTORE' LIMIT 1`;
  check('LEAD-09', 'Approved replacement restores the employer credit',
    restore?.credit_delta === 1 && !!restore.linked_entry_id, `delta ${restore?.credit_delta}`);

  // ---- LEAD-08: claim window ----------------------------------------------
  const policy = await activeCommercialPolicy();
  await setClock(addHours(SEED_INSTANT, policy.replacementWindowHours + 1));
  const late = await raiseReplacement('UNL-001', 'INVALID_CONTACT', 'Late claim attempt.');
  check('LEAD-08', 'Replacement claim outside the window is refused',
    'error' in late && late.error === 'CLAIM_WINDOW_CLOSED', JSON.stringify(late));

  // ---- REF-05: hold maturity ----------------------------------------------
  await setClock(SEED_INSTANT);
  await sql`UPDATE app.reward_ledger SET status='IN_HOLD' WHERE id='RWD-001'`;
  const earlyRelease = await releaseMaturedHolds();
  check('REF-05', 'Reward stays in hold before the fraud window matures',
    earlyRelease === 0, `${earlyRelease} released at T0`);

  await setClock(addHours(SEED_INSTANT, policy.partnerRewardHoldHours + 1));
  const lateRelease = await releaseMaturedHolds();
  check('REF-05', 'Reward becomes eligible once the hold matures',
    lateRelease === 1, `${lateRelease} released at T0+${policy.partnerRewardHoldHours + 1}h`);

  // ---- REF-10: payout minimum ---------------------------------------------
  const batch = await buildPayoutBatch('FIN-001');
  check('REF-10', 'Balance below the payout minimum carries forward instead of paying',
    batch.created.length === 0 && batch.skipped.some((s) => s.reason === 'BELOW_PAYOUT_MINIMUM'),
    `created ${batch.created.length}, skipped ${batch.skipped.map((s) => s.reason).join(',')}`);

  // ---- REF-02: attribution immutability -----------------------------------
  const reg = await startRegistration({
    phone: '+910000000001', language: 'mr', siteCode: 'NJN404', method: 'PARTNER_CODE',
  });
  check('REF-02', 'A returning number does not create a second candidate',
    reg.returning === true, `candidate ${reg.candidateId}`);

  const [attr] = await sql<{ partner_id: string }[]>`
    SELECT partner_id FROM app.attribution WHERE candidate_id='CAN-001'`;
  check('REF-02', 'A later scan cannot overwrite an existing attribution',
    attr.partner_id === 'PAR-001', `still ${attr.partner_id}`);

  // ---- §15: suspended source site -----------------------------------------
  const [an] = await sql<{ status: string; status_reason: string | null }[]>`
    SELECT status, status_reason FROM app.attribution WHERE candidate_id='CAN-008'`;
  check('§15', 'Registration through a suspended site is held for review, not silently credited',
    an.status === 'UNDER_REVIEW', `${an.status}: ${an.status_reason}`);

  // ---- END-05/06/07: endorsements -----------------------------------------
  const [flagged] = await sql<{ status: string; raw_points: number }[]>`
    SELECT status, raw_points FROM app.endorsement WHERE candidate_id='CAN-006'`;
  check('END-06', 'Self or duplicate endorsement is flagged and scores zero',
    flagged.status === 'FLAGGED' && flagged.raw_points === 0, `${flagged.status}, ${flagged.raw_points} pts`);

  const m1 = await computeMatch('CAN-001', 'JOB-001');
  const [cfg] = await sql<{ endorsement_cap: number }[]>`
    SELECT endorsement_cap FROM app.role_configuration WHERE id='CFG-BFSI-RE-1'`;
  check('END-07', 'Endorsement contribution never exceeds the configured cap',
    m1.endorsementPoints <= cfg.endorsement_cap && cfg.endorsement_cap <= 10,
    `${m1.endorsementPoints} of max ${cfg.endorsement_cap}`);

  // ---- CFG-07: configuration validation gates -----------------------------
  for (const id of ['CFG-BFSI-RE-1', 'CFG-BFSI-CSA-1', 'CFG-RTL-SA-1']) {
    const v = await validateRoleConfig(id);
    check('CFG-07', `${id} passes publication validation`, v.ok,
      v.checks.filter((c) => !c.ok).map((c) => c.name).join('; ') || 'all gates pass');
  }

  // ---- §18 launch gate: second industry, no code or schema change ---------
  const [rtl] = await sql<{ scoring_weights: Record<string, number>; assessment_threshold: number }[]>`
    SELECT scoring_weights, assessment_threshold FROM app.role_configuration WHERE id='CFG-RTL-SA-1'`;
  check('§18', 'A second industry configuration exists and is runnable',
    Object.values(rtl.scoring_weights).reduce((a, b) => a + b, 0) === 100 && rtl.assessment_threshold === 55,
    `weights total 100, threshold ${rtl.assessment_threshold}`);

  // ---- §15: stale job ------------------------------------------------------
  const [expired] = await sql<{ status: string }[]>`SELECT status FROM app.job WHERE id='JOB-005'`;
  check('§15', 'Stale job is expired and cannot accept applications', expired.status === 'EXPIRED', expired.status);
  const staleMatch = await computeMatch('CAN-001', 'JOB-005');
  check('§15', 'Expired job fails hard eligibility',
    staleMatch.stageA.reasons.includes('JOB_NOT_LIVE'), staleMatch.stageA.reasons.join(','));

  // ---- CAN-08: under-18 ----------------------------------------------------
  const minor = await startRegistration({ phone: '+910000000099', language: 'hi', siteCode: null, method: 'DIRECT' });
  await verifyAndBind(minor.candidateId, null);
  await grantConsent(minor.candidateId, 'PROCESSING');
  await completeProfile(minor.candidateId, {
    name: 'DEMO Minor Test', localityKey: 'kothrud', age18: false,
    experienceMonths: 0, experienceTags: [], languages: ['hi'],
    currentPayPaise: null, expectedPayPaise: rupees(15000), maxCommuteMin: 30, shiftAvailability: ['ANY'],
  });
  const [minorRow] = await sql<{ status: string }[]>`SELECT status FROM app.candidate WHERE id=${minor.candidateId}`;
  check('CAN-08', 'Candidate who cannot confirm 18+ is stopped', minorRow.status === 'DELETED_BLOCKED', minorRow.status);

  // ---- money discipline ----------------------------------------------------
  const [floats] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM information_schema.columns
     WHERE table_schema='app' AND column_name LIKE '%paise%' AND data_type NOT IN ('bigint','integer')`;
  check('§24.2', 'Every monetary column is an integer paise type', floats.n === '0', `${floats.n} non-integer money columns`);

  // ---- demo hygiene --------------------------------------------------------
  const [routable] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.candidate WHERE phone !~ '^\\+9100000000'`;
  check('§22', 'All demo phone numbers stay in the non-routable range', routable.n === '0', `${routable.n} outside range`);

  const [undemo] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.employer_organisation WHERE brand_name NOT LIKE 'DEMO %'`;
  check('§21.2', 'All fictional organisations are labelled DEMO', undemo.n === '0', `${undemo.n} unlabelled`);

  await setClock(SEED_INSTANT);

  // ---- report --------------------------------------------------------------
  const w = Math.max(...results.map((r) => r.name.length));
  console.log('\nPrototype acceptance — PRD v1.3 §25 and §23 backup paths\n');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.clause.padEnd(10)} ${r.name.padEnd(w)}  ${r.detail}`);
  }
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await sql.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
