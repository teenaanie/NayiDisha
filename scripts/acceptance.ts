/**
 * Prototype acceptance suite (§25) and the §23 backup demo paths.
 *
 * Run against a freshly seeded database: npm run db:reset && npm test
 * Every check maps to a numbered requirement so a failure names the clause it
 * breaks, not just an assertion.
 */
import { sql } from '../src/lib/db';
import { nextId } from '../src/lib/ids';
import { SEED_INSTANT, addHours } from '../src/lib/clock';
import { rupees } from '../src/lib/money';
import { computeMatch, previewsForJob, maskName } from '../src/modules/matching';
import {
  unlockQualifiedProfile, creditBalance, reconcileEntitlement,
  raiseReplacement, releaseMaturedHolds, buildPayoutBatch, partnerRewardSummary,
} from '../src/modules/commercial';
import { validateRoleConfig, activeCommercialPolicy, getRoleConfig } from '../src/modules/configuration';
import { startRegistration, verifyAndBind, grantConsent, completeProfile } from '../src/modules/candidate';
import { dispatchJobAlerts, respondToAlert, sendNudge, NUDGE_LIMIT_PER_WEEK } from '../src/modules/alerts';
import {
  proposeInterview, respondToInterview, rescheduleInterview, recordInterviewOutcome,
  sendDueInterviewReminders, makeOffer, respondToOffer, uploadDocument, reviewDocument,
  markJoined, documentsForCase,
} from '../src/modules/hiring';
import {
  editJob, setJobState, duplicateJob, createEndorsementInvite, submitEndorsement,
  withdrawEndorsement, setEndorsementHidden, updatePreferences, resumePoint,
  raiseDataRequest, acceptConduct,
} from '../src/modules/lifecycle';

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

  // ---- §24: serverless connection discipline -------------------------------
  // A transaction holds its connection for its whole life. A helper called
  // inside `sql.begin` that reaches for the module-level `sql` instead of the
  // transaction handle waits for a connection the transaction cannot release —
  // a permanent hang with no error and no log line. It took the deployed demo
  // down, because a serverless pool is tiny by necessity.
  //
  // This runs FIRST and exits on failure. A deadlocked transaction never gives
  // its connection back, so every later check would hang behind it and the
  // suite would report nothing at all — the same silent failure as the bug.
  // `npm run test:serverless` runs at PG_POOL_MAX=1, which is the condition
  // that turns the mistake into a hang.
  const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([
    p, new Promise<'TIMED_OUT'>((r) => setTimeout(() => r('TIMED_OUT'), ms)),
  ]);

  const helperTx = await withTimeout(sql.begin(async (tx) => {
    await nextId('EMP', tx);
    await getRoleConfig('CFG-BFSI-RE-1', tx);
    await creditBalance('ENT-001', tx);
    return 'completed';
  }), 8000);
  if (helperTx === 'TIMED_OUT') {
    console.error(
      '\n  \u2717 \u00a724       Transaction deadlocked on a pool of ' +
      `${process.env.PG_POOL_MAX ?? 'default'}.\n` +
      '            A helper inside sql.begin is using the module-level sql\n' +
      '            instead of the transaction handle. Nothing else can run.\n');
    process.exit(1);
  }
  check('\u00a724', 'Helpers inside a transaction use the transaction connection',
    true, 'nextId, getRoleConfig and creditBalance all honoured the handle');

  // ---- §25: persisted state -----------------------------------------------
  // Assert the canonical eight are present by ID rather than counting rows —
  // this suite creates its own fixtures (the under-18 case below), so a row
  // count makes the check fail on a second run against the same database.
  const [{ n: candN }] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.candidate
     WHERE id IN ('CAN-001','CAN-002','CAN-003','CAN-004','CAN-005','CAN-006','CAN-007','CAN-008')
  `;
  check('§25', 'Success path runs from persisted data', Number(candN) === 8,
    `${candN}/8 canonical candidates present`);

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
    blocked.status === 'BLOCKED' && String(blocked.reason).includes('INTEREST_NOT_RECONFIRMED'), String(blocked.reason));
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


  // =========================================================================
  // §8.6 alerts, §8.9 interviews, §8.10 onboarding, job & endorsement lifecycle
  // =========================================================================
  await setClock(SEED_INSTANT);

  // The checks below deliberately mutate seeded rows — they pause a job, change
  // its pay, withdraw a consent. A suite that leaves that behind passes once and
  // fails on the second run, which is worse than no suite at all. So: snapshot
  // the seeded state here, and put it back at the end of the block.
  const FIXTURE_JOBS = ['JOB-001', 'JOB-002', 'JOB-003'];
  const jobSnapshot = await sql<{
    id: string; title: string; status: string; fixed_pay_paise: string;
  }[]>`SELECT id, title, status, fixed_pay_paise::text FROM app.job WHERE id = ANY(${FIXTURE_JOBS})`;

  const [prefSnapshot] = await sql<{ max_commute_min: number; alert_max_per_week: number }[]>`
    SELECT max_commute_min, alert_max_per_week FROM app.candidate WHERE id='CAN-005'`;

  const clearAlertFixtures = async () => {
    await sql`DELETE FROM app.job_alert WHERE job_id = ANY(${FIXTURE_JOBS})`;
    await sql`DELETE FROM app.partner_job_alert WHERE job_id = ANY(${FIXTURE_JOBS})`;
    await sql`UPDATE app.consent_record SET withdrawn_at = NULL
               WHERE purpose = 'JOB_ALERTS' AND candidate_id IN ('CAN-002','CAN-004')`;
  };
  await clearAlertFixtures();

  // ---- ALT-01/02: dispatch and suppression -------------------------------
  const notLive = await dispatchJobAlerts('JOB-005');   // expired
  check('JOB-05', 'An expired job dispatches no alerts',
    notLive.candidatesAlerted === 0 && notLive.partnersAlerted === 0,
    `${notLive.candidatesAlerted} candidates`);

  const dispatch = await dispatchJobAlerts('JOB-001');
  check('ALT-01', 'A live job alerts eligible candidates and relevant partners',
    dispatch.candidatesAlerted > 0 && dispatch.partnersAlerted > 0,
    `${dispatch.candidatesAlerted} candidates, ${dispatch.partnersAlerted} partners`);

  const againSameJob = await dispatchJobAlerts('JOB-001');
  check('ALT-02', 'The same job never alerts the same candidate twice',
    againSameJob.candidatesAlerted === 0,
    `${againSameJob.suppressed.filter((s) => s.reason === 'ALREADY_ALERTED').length} already alerted`);

  await sql`UPDATE app.consent_record SET withdrawn_at = ${SEED_INSTANT}
             WHERE candidate_id = 'CAN-002' AND purpose = 'JOB_ALERTS'`;
  const noConsent = await dispatchJobAlerts('JOB-003');
  check('ALT-02', 'A candidate without alert consent is suppressed, with a reason',
    noConsent.suppressed.some((s) => s.candidateId === 'CAN-002' && s.reason === 'NO_ALERT_CONSENT'),
    noConsent.suppressed.find((s) => s.candidateId === 'CAN-002')?.reason ?? 'not suppressed');

  // Quiet hours: 02:00 IST falls inside the default 21:00–08:00 window.
  await setClock(new Date('2026-10-06T02:00:00+05:30'));
  const quiet = await dispatchJobAlerts('JOB-002');
  check('ALT-02', 'No alert is sent during a candidate\'s quiet hours',
    quiet.candidatesAlerted === 0 && quiet.suppressed.some((s) => s.reason === 'QUIET_HOURS'),
    `${quiet.suppressed.filter((s) => s.reason === 'QUIET_HOURS').length} suppressed for quiet hours`);
  await setClock(SEED_INSTANT);

  // ---- ALT-03: partner alerts carry no candidate data --------------------
  const [pa] = await sql<{ cols: string }[]>`
    SELECT string_agg(column_name, ',') AS cols FROM information_schema.columns
     WHERE table_schema='app' AND table_name='partner_job_alert'`;
  check('ALT-03', 'Partner alerts carry role and bounty only, never candidate data',
    !/candidate/.test(pa.cols), pa.cols);

  // ---- ALT-04: acting from the alert -------------------------------------
  const [anAlert] = await sql<{ id: string; candidate_id: string }[]>`
    SELECT id, candidate_id FROM app.job_alert WHERE candidate_id='CAN-004' LIMIT 1`;
  if (anAlert) {
    await respondToAlert(anAlert.id, 'STOP_ALERTS');
    const [c4] = await sql<{ withdrawn_at: Date | null }[]>`
      SELECT withdrawn_at FROM app.consent_record
       WHERE candidate_id='CAN-004' AND purpose='JOB_ALERTS'`;
    check('ALT-04', '"Stop alerts" withdraws alert consent but not job access',
      !!c4?.withdrawn_at, 'consent withdrawn');
  }

  // ---- ALT-05/06: nudges --------------------------------------------------
  const wrongPartner = await sendNudge('PAR-002', 'CAN-001', 'JOB-001');
  check('ALT-05', 'A partner cannot nudge a candidate they did not source',
    'error' in wrongPartner && wrongPartner.error === 'NOT_YOUR_CANDIDATE', JSON.stringify(wrongPartner));

  for (let i = 0; i < NUDGE_LIMIT_PER_WEEK; i++) await sendNudge('PAR-001', 'CAN-001', 'JOB-001');
  const overLimit = await sendNudge('PAR-001', 'CAN-001', 'JOB-001');
  check('ALT-06', 'Nudges are rate-limited per candidate per week',
    'error' in overLimit && overLimit.error === 'NUDGE_RATE_LIMIT', JSON.stringify(overLimit));

  // ---- §8.9 interviews ----------------------------------------------------
  const [notUnlocked] = await sql<{ id: string }[]>`
    SELECT a.id FROM app.application a
     WHERE a.candidate_id='CAN-005' AND a.job_id='JOB-001'`;
  const badItv = await proposeInterview(notUnlocked.id, new Date('2026-10-09T11:00:00+05:30'),
    'IN_PERSON', 'FC Road', 'Never pay for an interview.');
  check('INT-01', 'An interview cannot be scheduled before the profile is unlocked',
    'error' in badItv && badItv.error === 'PROFILE_NOT_UNLOCKED', JSON.stringify(badItv));

  const [unlockedApp] = await sql<{ id: string }[]>`
    SELECT application_id AS id FROM app.qualified_lead_unlock
     WHERE status='CONFIRMED' ORDER BY unlocked_at LIMIT 1`;
  const itv = await proposeInterview(unlockedApp.id, new Date('2026-10-09T11:00:00+05:30'),
    'IN_PERSON', 'FC Road Branch', 'Come to reception. Never pay anyone for an interview.');
  check('INT-01', 'A proposed interview starts unconfirmed', 'interviewId' in itv, JSON.stringify(itv));

  const itvId = (itv as { interviewId: string }).interviewId;
  const early = await sendDueInterviewReminders();
  check('INT-04', 'No reminder before the candidate confirms', early === 0, `${early} sent`);

  await respondToInterview(itvId, true);
  const stillEarly = await sendDueInterviewReminders();
  check('INT-04', 'No reminder until inside the 24 hours before the slot',
    stillEarly === 0, `${stillEarly} sent at T0`);

  await setClock(new Date('2026-10-09T09:00:00+05:30'));
  const dueNow = await sendDueInterviewReminders();
  check('INT-04', 'Reminder goes out inside the 24-hour window, exactly once',
    dueNow === 1 && (await sendDueInterviewReminders()) === 0, `${dueNow} sent`);
  await setClock(SEED_INSTANT);

  await rescheduleInterview(itvId, new Date('2026-10-11T15:00:00+05:30'));
  const [resched] = await sql<{ rescheduled_from: Date | null; candidate_confirmed: boolean; status: string }[]>`
    SELECT rescheduled_from, candidate_confirmed, status FROM app.interview WHERE id=${itvId}`;
  check('INT-03', 'Rescheduling keeps the original time and re-opens confirmation',
    !!resched.rescheduled_from && resched.candidate_confirmed === false,
    `was ${resched.rescheduled_from?.toISOString().slice(0, 16)}, status ${resched.status}`);

  await recordInterviewOutcome(itvId, 'NO_SHOW_EMPLOYER');
  const [ns] = await sql<{ no_show_by: string | null }[]>`
    SELECT no_show_by FROM app.interview WHERE id=${itvId}`;
  check('INT-05', 'A no-show is attributed to whichever side missed it',
    ns.no_show_by === 'EMPLOYER', String(ns.no_show_by));

  // ---- §8.10 onboarding ---------------------------------------------------
  const badOffer = await makeOffer({
    applicationId: notUnlocked.id, roleTitle: 'RE', locationId: 'LOC-001',
    fixedPaise: rupees(19000), variablePaise: rupees(6000),
    joiningDate: '2026-10-20', offerValidHours: 72,
  });
  check('ONB-01', 'An offer cannot be made before the profile is unlocked',
    'error' in badOffer && badOffer.error === 'PROFILE_NOT_UNLOCKED', JSON.stringify(badOffer));

  const offer = await makeOffer({
    applicationId: unlockedApp.id, roleTitle: 'Relationship Executive', locationId: 'LOC-001',
    fixedPaise: rupees(19000), variablePaise: rupees(6000),
    joiningDate: '2026-10-20', offerValidHours: 72,
  });
  const caseId = (offer as { caseId: string }).caseId;
  check('ONB-01', 'Offer records fixed and variable pay separately',
    !!caseId, caseId ?? JSON.stringify(offer));

  await setClock(addHours(SEED_INSTANT, 73));
  const expiredOffer = await respondToOffer(caseId, true);
  check('ONB-02', 'An offer past its expiry cannot be accepted',
    'error' in expiredOffer && expiredOffer.error === 'OFFER_EXPIRED', JSON.stringify(expiredOffer));
  await setClock(SEED_INSTANT);
  await sql`UPDATE app.onboarding_case SET status='OFFER_SENT' WHERE id=${caseId}`;

  const accepted = await respondToOffer(caseId, true);
  check('ONB-02', 'Accepting opens the document checklist',
    'status' in accepted && accepted.status === 'DOCUMENTS_PENDING', JSON.stringify(accepted));

  const docs = await documentsForCase(caseId);
  const cfgChecklist = (await sql<{ document_checklist: string[] }[]>`
    SELECT document_checklist FROM app.role_configuration WHERE id='CFG-BFSI-RE-1'`)[0].document_checklist;
  check('ONB-03', 'The checklist comes from the role configuration, not from code',
    docs.length === cfgChecklist.length &&
    docs.every((d) => cfgChecklist.includes(d.document_key)),
    `${docs.length} documents: ${docs.map((d) => d.document_key).join(', ')}`);

  await uploadDocument(docs[0].id);
  const noReason = await reviewDocument(docs[0].id, 'REJECTED');
  check('ONB-07', 'A document cannot be rejected without a reason',
    'error' in noReason && noReason.error === 'REASON_REQUIRED', JSON.stringify(noReason));

  await reviewDocument(docs[0].id, 'REJECTED', 'Photo unreadable — please retake in daylight.');
  const [rejected] = await sql<{ status: string; reject_reason: string | null }[]>`
    SELECT status, reject_reason FROM app.candidate_document WHERE id=${docs[0].id}`;
  check('ONB-07', 'A rejected document can be uploaded again',
    rejected.status === 'REJECTED' && !!rejected.reject_reason, rejected.reject_reason ?? '');

  for (const d of docs) { await uploadDocument(d.id); await reviewDocument(d.id, 'APPROVED'); }
  const [caseAfter] = await sql<{ status: string }[]>`
    SELECT status FROM app.onboarding_case WHERE id=${caseId}`;
  check('ONB-03', 'The case completes only when every document is approved',
    caseAfter.status === 'DOCUMENTS_COMPLETE', caseAfter.status);

  // ONB-06 — none of this may move money.
  const ledgerBefore = (await sql<{ n: string }[]>`
    SELECT COALESCE(SUM(amount_paise),0)::text n FROM app.reward_ledger`)[0].n;
  await markJoined(caseId);
  const ledgerAfter = (await sql<{ n: string }[]>`
    SELECT COALESCE(SUM(amount_paise),0)::text n FROM app.reward_ledger`)[0].n;
  check('ONB-06', 'Recording a joining changes no money at all',
    ledgerBefore === ledgerAfter, `ledger ₹${Number(ledgerBefore) / 100} unchanged`);

  // ---- JOB-04/05 lifecycle -----------------------------------------------
  const minorEdit = await editJob('JOB-002', { title: 'Customer Service Associate (Kothrud)' }, 'EU-001');
  check('JOB-04', 'A title change is minor and notifies nobody',
    'material' in minorEdit && minorEdit.material === false && minorEdit.notified === 0,
    `notified ${('notified' in minorEdit ? minorEdit.notified : '?')}`);

  const material = await editJob('JOB-001', { fixedPayPaise: rupees(19500) }, 'EU-001');
  check('JOB-04', 'A pay change requires approval before becoming live',
    'material' in material && material.material === true && !!(await sql`SELECT id FROM app.job WHERE id='JOB-001' AND status='PENDING_APPROVAL' AND pending_changes IS NOT NULL`).length,
    `notified ${('notified' in material ? material.notified : '?')}`);

  await setJobState('JOB-001', 'PAUSED', 'Paused for the test', 'EU-001');
  const pausedAlerts = await dispatchJobAlerts('JOB-001');
  check('JOB-05', 'A paused job stops alerting immediately',
    pausedAlerts.candidatesAlerted === 0, `${pausedAlerts.candidatesAlerted} alerted`);
  await setJobState('JOB-001', 'LIVE', 'Resumed for the test', 'EU-001');

  const dup = await duplicateJob('JOB-001', 'EU-001');
  const [dupRow] = await sql<{ status: string; duplicated_from: string | null }[]>`
    SELECT status, duplicated_from FROM app.job WHERE id=${(dup as { jobId: string }).jobId}`;
  check('JOB-01', 'A duplicated job starts as a draft awaiting approval, never live',
    dupRow.status === 'PENDING_APPROVAL' && dupRow.duplicated_from === 'JOB-001', dupRow.status);

  // ---- END-02/03/09 endorsement lifecycle --------------------------------
  const inv = await createEndorsementInvite('CAN-005', 'DEMO Anil Rane', '+910000009077', 'FORMER_MANAGER');
  const noConsentSubmit = await submitEndorsement(inv.token, {
    relationship: 'FORMER_MANAGER', periodKnown: '2 years',
    competencies: ['RELIABILITY'], comment: 'Dependable.', displayConsent: false, otp: '123456',
  });
  check('END-02', 'An endorsement cannot be submitted without display consent',
    'error' in noConsentSubmit && noConsentSubmit.error === 'DISPLAY_CONSENT_REQUIRED',
    JSON.stringify(noConsentSubmit));

  const submitted = await submitEndorsement(inv.token, {
    relationship: 'FORMER_MANAGER', periodKnown: '2 years',
    competencies: ['RELIABILITY'], comment: 'Dependable.', displayConsent: true, otp: '123456',
  });
  check('END-02', 'The endorser submits after verifying a channel',
    'ok' in submitted && submitted.ok === true, JSON.stringify(submitted));

  const reuse = await submitEndorsement(inv.token, {
    relationship: 'PEER', periodKnown: '1 year', competencies: ['TEAMWORK'],
    comment: 'Again.', displayConsent: true, otp: '123456',
  });
  check('END-01', 'An invitation link is single use',
    'error' in reuse, JSON.stringify(reuse));

  const wd = (submitted as { withdrawToken: string }).withdrawToken;
  await withdrawEndorsement(wd);
  const [afterWd] = await sql<{ status: string; raw_points: number }[]>`
    SELECT status, raw_points FROM app.endorsement WHERE id=${inv.id}`;
  check('END-03', 'The endorser can withdraw later, and it stops scoring',
    afterWd.status === 'WITHDRAWN' && afterWd.raw_points === 0,
    `${afterWd.status}, ${afterWd.raw_points} points`);

  const [verified] = await sql<{ id: string }[]>`
    SELECT id FROM app.endorsement WHERE status='VERIFIED_CONTACT' LIMIT 1`;
  if (verified) {
    await setEndorsementHidden(verified.id, true);
    const [hid] = await sql<{ status: string; raw_points: number }[]>`
      SELECT status, raw_points FROM app.endorsement WHERE id=${verified.id}`;
    check('END-09', 'A candidate can hide an endorsement, and hidden scores zero',
      hid.status === 'HIDDEN' && hid.raw_points === 0, `${hid.status}, ${hid.raw_points} points`);
    await setEndorsementHidden(verified.id, false);
  }

  // ---- CAN-02/04/06 self-service -----------------------------------------
  await updatePreferences('CAN-005', { maxCommuteMin: 20, alertMaxPerWeek: 1 });
  const [prefs] = await sql<{ max_commute_min: number; alert_max_per_week: number }[]>`
    SELECT max_commute_min, alert_max_per_week FROM app.candidate WHERE id='CAN-005'`;
  check('CAN-04', 'A candidate can change commute and alert-frequency preferences',
    prefs.max_commute_min === 20 && prefs.alert_max_per_week === 1,
    `${prefs.max_commute_min} min, ${prefs.alert_max_per_week}/week`);

  const tighter = await computeMatch('CAN-005', 'JOB-001');
  check('CAN-04', 'A tighter commute limit changes eligibility immediately',
    !tighter.stageA.pass && tighter.stageA.reasons.includes('COMMUTE_EXCEEDS_CANDIDATE_LIMIT'),
    tighter.stageA.reasons.join(','));

  const resume = await resumePoint('CAN-001');
  check('CAN-02', 'A completed candidate resumes at the jobs step, not the beginning',
    resume.step === 'jobs', resume.step);

  const dr = await raiseDataRequest('CAN-001', 'ERASURE', 'Please delete my profile.');
  const [drRow] = await sql<{ due_at: Date; created_at: Date }[]>`
    SELECT due_at, created_at FROM app.data_request WHERE id=${dr.id}`;
  const days = Math.round((drRow.due_at.getTime() - drRow.created_at.getTime()) / 86400000);
  check('CAN-06', 'A data request carries the 90-day response clock the Rules require',
    days === 90, `${days} days`);

  // ---- PART-07 conduct ----------------------------------------------------
  await acceptConduct('PAR-002');
  const [conduct] = await sql<{ conduct_accepted_at: Date | null; conduct_version: string | null }[]>`
    SELECT conduct_accepted_at, conduct_version FROM app.partner WHERE id='PAR-002'`;
  check('PART-07', 'Conduct acceptance records the version and the moment',
    !!conduct.conduct_accepted_at && !!conduct.conduct_version, String(conduct.conduct_version));

  await setClock(SEED_INSTANT);

  // ---- §24: the unlock is the money path ---------------------------------
  // The unlock is the money path and the largest transaction in the app, so it
  // gets the same proof rather than an argument from code reading.
  // Restore the independent money-path fixture after lifecycle and preference tests.
  await sql`UPDATE app.job SET status='LIVE',pending_changes=NULL WHERE id='JOB-001'`;
  await sql`UPDATE app.application SET reconfirmed_at=${SEED_INSTANT} WHERE candidate_id='CAN-005' AND job_id='JOB-001'`;
  await updatePreferences('CAN-005',{maxCommuteMin:60});
  const freshUnlock = await withTimeout(
    unlockQualifiedProfile('EMP-001', 'JOB-001', 'CAN-005', 'EU-001'), 8000);
  check('§24', 'A new unlock completes inside one transaction',
    freshUnlock !== 'TIMED_OUT' && freshUnlock.status === 'CREATED',
    freshUnlock === 'TIMED_OUT' ? 'deadlocked' : `${freshUnlock.status} ${freshUnlock.unlockId ?? ''}`);

  if (freshUnlock !== 'TIMED_OUT' && freshUnlock.unlockId) {
    const u = freshUnlock.unlockId;
    await sql`DELETE FROM app.reward_ledger WHERE unlock_id = ${u}`;
    await sql`DELETE FROM app.credit_ledger WHERE unlock_id = ${u}`;
    await sql`DELETE FROM app.audit_log WHERE entity_id = ${u}`;
    await sql`DELETE FROM app.qualified_lead_unlock WHERE id = ${u}`;
    await sql`UPDATE app.application SET status='QUALIFIED'
               WHERE candidate_id='CAN-005' AND job_id='JOB-001'`;
  }

  // ---- put the seeded fixtures back ---------------------------------------
  // Everything above this line is deliberate mutation; everything below assumes
  // the seed. Restoring here is what makes `npm test` repeatable without a reset.
  await clearAlertFixtures();
  for (const j of jobSnapshot) {
    await sql`UPDATE app.job
                 SET title = ${j.title}, status = ${j.status},
                     fixed_pay_paise = ${Number(j.fixed_pay_paise)}
               WHERE id = ${j.id}`;
  }
  await sql`DELETE FROM app.job_change WHERE job_id = ANY(${FIXTURE_JOBS})`;
  await sql`DELETE FROM app.job WHERE duplicated_from = ANY(${FIXTURE_JOBS})`;
  await sql`UPDATE app.candidate
               SET max_commute_min = ${prefSnapshot.max_commute_min},
                   alert_max_per_week = ${prefSnapshot.alert_max_per_week}
             WHERE id='CAN-005'`;

  // ---- report --------------------------------------------------------------
  const w = Math.max(...results.map((r) => r.name.length));
  console.log(`\nPrototype acceptance — PRD v1.3 §25 and §23 backup paths`);
  console.log(`  connection pool: max ${process.env.PG_POOL_MAX ?? 'default'}\n`);
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.clause.padEnd(10)} ${r.name.padEnd(w)}  ${r.detail}`);
  }
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await sql.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
