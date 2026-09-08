'use server';
import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { now, advanceClock, setClock, SEED_INSTANT } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import {
  unlockQualifiedProfile, raiseReplacement, decideReplacement,
  releaseMaturedHolds, buildPayoutBatch, approveAndExecutePayout,
} from '@/modules/commercial';
import { publishRoleConfig, validateRoleConfig } from '@/modules/configuration';
import {
  startRegistration, verifyAndBind, grantConsent, completeProfile,
  recordAssessment, inviteEndorsement, verifyEndorsement,
  applyAndEvaluate, withdrawConsent, sendTemplate,
} from '@/modules/candidate';
import { recordMatch } from '@/modules/matching';

const touchAll = () => {
  for (const p of ['/', '/ops', '/employer', '/partner', '/finance', '/wa']) {
    revalidatePath(p, 'layout');
  }
};

// ---- demo controls ---------------------------------------------------------
export async function actAdvanceClock(hours: number) {
  await advanceClock(hours);
  await releaseMaturedHolds();
  await expireStaleJobs();
  touchAll();
}

export async function actResetClock() {
  await setClock(SEED_INSTANT);
  touchAll();
}

/** §15 stale-job row — auto-expire at 30 days, stop alerts and applications. */
export async function expireStaleJobs() {
  const at = await now();
  await sql`
    UPDATE app.job SET status = 'EXPIRED'
     WHERE status = 'LIVE' AND expires_at IS NOT NULL AND expires_at <= ${at}
  `;
}

// ---- operations ------------------------------------------------------------
export async function actPublishConfig(configId: string) {
  const at = await now();
  await publishRoleConfig(configId, 'OPS-001', at);
  touchAll();
}

export async function actValidateConfig(configId: string) {
  return validateRoleConfig(configId);
}

/** CFG-09 — change a sandbox configuration without deployment or migration. */
export async function actUpdateSandboxWeights(configId: string, weights: Record<string, number>) {
  await sql`
    UPDATE app.role_configuration SET scoring_weights = ${sql.json(weights as never)}
     WHERE id = ${configId} AND status IN ('SANDBOX','DRAFT')
  `;
  touchAll();
}

export async function actUpdateSandboxThreshold(configId: string, threshold: number) {
  await sql`
    UPDATE app.role_configuration
       SET assessment_threshold = ${threshold},
           qualification_rules = jsonb_set(qualification_rules, '{minAssessmentScore}', ${String(threshold)}::jsonb)
     WHERE id = ${configId} AND status IN ('SANDBOX','DRAFT')
  `;
  touchAll();
}

export async function actApproveEmployer(employerId: string) {
  const at = await now();
  await sql`
    UPDATE app.employer_organisation SET status = 'VERIFIED', status_at = ${at} WHERE id = ${employerId}
  `;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, 'OPS-001', 'OPERATIONS', 'EMPLOYER_APPROVED',
            'employer_organisation', ${employerId}, 'OPS-EMP-01', ${at})
  `;
  touchAll();
}

export async function actSuspendEmployer(employerId: string, reason: string) {
  const at = await now();
  await sql`
    UPDATE app.employer_organisation SET status='SUSPENDED', status_reason=${reason}, status_at=${at}
     WHERE id = ${employerId}
  `;
  // OPS-EMP-05 — pause jobs without deleting audit history.
  await sql`UPDATE app.job SET status='SUSPENDED' WHERE employer_id=${employerId} AND status='LIVE'`;
  touchAll();
}

export async function actApproveJob(jobId: string) {
  const at = await now();
  const [policy] = await sql<{ job_expiry_days: number }[]>`
    SELECT job_expiry_days FROM app.commercial_policy WHERE active = TRUE
  `;
  const expires = new Date(at.getTime() + policy.job_expiry_days * 86400_000);
  await sql`
    UPDATE app.job SET status='LIVE', published_at=${at}, expires_at=${expires}
     WHERE id=${jobId} AND status='PENDING_APPROVAL'
  `;
  const entId = `ENT-${jobId.slice(4)}`;
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM app.posting_entitlement WHERE job_id=${jobId}`;
  if (!existing) {
    const [p] = await sql<{
      posting_fee_paise: string; included_unlock_credits: number;
      max_distinct_unlocks_per_job: number; credit_expiry_days: number;
    }[]>`SELECT * FROM app.commercial_policy WHERE active = TRUE`;
    const [loc] = await sql<{ location_id: string }[]>`SELECT location_id FROM app.job WHERE id=${jobId}`;
    await sql`
      INSERT INTO app.posting_entitlement
        (id, job_id, location_id, posting_fee_paise, credits_included, max_distinct_unlocks,
         starts_at, ends_at, credit_expiry_at, created_at)
      VALUES (${entId}, ${jobId}, ${loc.location_id}, ${p.posting_fee_paise}, ${p.included_unlock_credits},
              ${p.max_distinct_unlocks_per_job}, ${at}, ${expires},
              ${new Date(at.getTime() + p.credit_expiry_days * 86400_000)}, ${at})
    `;
    await sql`
      INSERT INTO app.credit_ledger (id, entitlement_id, entry_type, credit_delta, amount_paise, note, created_at)
      VALUES (${await nextId('CRD')}, ${entId}, 'INCLUDED_GRANT', ${p.included_unlock_credits},
              ${p.posting_fee_paise}, 'Included with posting entitlement', ${at})
    `;
  }
  touchAll();
}

export async function actRotateQr(siteId: string) {
  const [site] = await sql<{ partner_code: string }[]>`
    SELECT partner_code FROM app.partner_site WHERE id=${siteId}
  `;
  await sql`
    UPDATE app.partner_site SET qr_token = ${'qr_' + site.partner_code + '_' + Math.random().toString(36).slice(2, 7).toUpperCase()}
     WHERE id = ${siteId}
  `;
  touchAll();
}

export async function actSetPartnerStatus(partnerId: string, status: 'VERIFIED' | 'SUSPENDED', reason: string) {
  const at = await now();
  await sql`
    UPDATE app.partner SET status=${status}, status_reason=${reason}, status_at=${at} WHERE id=${partnerId}
  `;
  if (status === 'SUSPENDED') {
    await sql`UPDATE app.partner_site SET status='SUSPENDED' WHERE partner_id=${partnerId}`;
    // PART-10 — hold rewards with an auditable reason.
    await sql`UPDATE app.reward_ledger SET status='DISPUTED' WHERE partner_id=${partnerId} AND status IN ('IN_HOLD','ELIGIBLE')`;
  } else {
    await sql`UPDATE app.partner_site SET status='ACTIVE' WHERE partner_id=${partnerId}`;
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, 'OPS-001', 'OPERATIONS', ${'PARTNER_' + status},
            'partner', ${partnerId}, ${reason}, ${at})
  `;
  touchAll();
}

export async function actResolveAttribution(attributionId: string, decision: 'ACTIVE' | 'VOID') {
  await sql`
    UPDATE app.attribution SET status=${decision}, status_reason='Resolved by operations' WHERE id=${attributionId}
  `;
  await sql`
    UPDATE app.fraud_case SET status='RESOLVED', resolution=${decision}
     WHERE subject_type='attribution' AND subject_id=${attributionId}
  `;
  touchAll();
}

// ---- employer --------------------------------------------------------------
export async function actUnlock(employerId: string, jobId: string, candidateId: string) {
  const r = await unlockQualifiedProfile(employerId, jobId, candidateId, 'EU-001');
  if (r.status === 'CREATED') {
    // CAN-09 — the candidate is told their profile went to an employer.
    const [emp] = await sql<{ brand_name: string }[]>`
      SELECT brand_name FROM app.employer_organisation WHERE id = ${employerId}
    `;
    await sendTemplate(candidateId, 'shared_with_employer', { employer: emp.brand_name });
  }
  touchAll();
  return r;
}

export async function actRecordOutcome(applicationId: string, outcome: string) {
  const at = await now();
  await sql`
    INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
    VALUES (${await nextId('OUT')}, ${applicationId}, ${outcome}, 'EU-001', 'EMPLOYER_PORTAL', ${at})
  `;
  const statusMap: Record<string, string> = {
    CONTACTED: 'CONTACTED', INTERVIEW_SCHEDULED: 'INTERVIEW', INTERVIEW_ATTENDED: 'INTERVIEW',
    REJECTED: 'REJECTED', SELECTED: 'SELECTED', JOINED: 'JOINED',
  };
  if (statusMap[outcome]) {
    await sql`UPDATE app.application SET status=${statusMap[outcome]}, status_at=${at} WHERE id=${applicationId}`;
  }
  touchAll();
}

export async function actRaiseReplacement(unlockId: string, reason: string, evidence: string) {
  const r = await raiseReplacement(
    unlockId, reason as 'INVALID_CONTACT' | 'NEVER_APPLIED' | 'DUPLICATE_PROFILE', evidence,
  );
  touchAll();
  return r;
}

export async function actBuyCredits(jobId: string, count: number) {
  const at = await now();
  const [ent] = await sql<{ id: string }[]>`SELECT id FROM app.posting_entitlement WHERE job_id=${jobId}`;
  const [p] = await sql<{ additional_credit_paise: string }[]>`
    SELECT additional_credit_paise FROM app.commercial_policy WHERE active=TRUE
  `;
  await sql`
    INSERT INTO app.credit_ledger (id, entitlement_id, entry_type, credit_delta, amount_paise, note, created_at)
    VALUES (${await nextId('CRD')}, ${ent.id}, 'PURCHASE', ${count},
            ${Number(p.additional_credit_paise) * count}, ${count + ' additional unlock credits'}, ${at})
  `;
  touchAll();
}

// ---- operations: replacement decisions -------------------------------------
export async function actDecideReplacement(caseId: string, decision: 'APPROVED' | 'REJECTED') {
  await decideReplacement(caseId, decision, 'OPS-001');
  touchAll();
}

// ---- finance ---------------------------------------------------------------
export async function actReleaseHolds() { await releaseMaturedHolds(); touchAll(); }
export async function actBuildBatch() { const r = await buildPayoutBatch('FIN-001'); touchAll(); return r; }
export async function actApprovePayout(payoutId: string) {
  const r = await approveAndExecutePayout(payoutId, 'FIN-001'); touchAll(); return r;
}

// ---- candidate / WhatsApp simulator ----------------------------------------
export async function actWaStart(phone: string, language: 'mr'|'hi'|'en', siteCode: string | null) {
  const reg = await startRegistration({
    phone, language, siteCode,
    method: siteCode ? (siteCode.startsWith('qr_') ? 'QR' : 'PARTNER_CODE') : 'DIRECT',
  });
  await sendTemplate(reg.candidateId, 'welcome');
  touchAll();
  return reg;
}

export async function actWaVerify(candidateId: string, pending: { siteId: string|null; partnerId: string|null; method: 'QR'|'PARTNER_CODE'|'DIRECT'; valid: boolean } | null) {
  await verifyAndBind(candidateId, pending);
  await grantConsent(candidateId, 'PROCESSING');
  await grantConsent(candidateId, 'JOB_ALERTS');
  if (pending?.partnerId) {
    await grantConsent(candidateId, 'PARTNER_ASSISTANCE');
    const [p] = await sql<{ name: string }[]>`SELECT name FROM app.partner WHERE id=${pending.partnerId}`;
    await sendTemplate(candidateId, 'source_confirm', { partner: p?.name ?? 'your local partner' });
  }
  await sendTemplate(candidateId, 'consent_notice');
  touchAll();
}

export async function actWaProfile(candidateId: string, form: {
  name: string; localityKey: string; experienceMonths: number; experienceTags: string[];
  languages: string[]; expectedPay: number; currentPay: number | null; maxCommuteMin: number;
}) {
  await completeProfile(candidateId, {
    name: form.name, localityKey: form.localityKey, age18: true,
    experienceMonths: form.experienceMonths, experienceTags: form.experienceTags,
    languages: form.languages,
    currentPayPaise: form.currentPay === null ? null : form.currentPay * 100,
    expectedPayPaise: form.expectedPay * 100,
    maxCommuteMin: form.maxCommuteMin, shiftAvailability: ['ANY'],
  });
  touchAll();
}

export async function actWaAssessment(candidateId: string, templateId: string, answers: Record<string, string>) {
  const r = await recordAssessment(candidateId, templateId, answers);
  touchAll();
  return r;
}

export async function actWaEndorse(candidateId: string, endorserName: string, contact: string, relationship: string) {
  const inv = await inviteEndorsement(
    candidateId, endorserName, contact,
    relationship as 'FORMER_MANAGER' | 'SENIOR_COLLEAGUE' | 'EXPERIENCED_COLLEAGUE' | 'PEER',
    ['CUSTOMER_COMMUNICATION', 'RELIABILITY'],
  );
  const r = await verifyEndorsement(inv.id);
  touchAll();
  return { id: inv.id, ...r };
}

export async function actWaApply(candidateId: string, jobId: string) {
  const r = await applyAndEvaluate(candidateId, jobId);
  const [job] = await sql<{ employer_id: string }[]>`SELECT employer_id FROM app.job WHERE id=${jobId}`;
  const [emp] = await sql<{ brand_name: string }[]>`
    SELECT brand_name FROM app.employer_organisation WHERE id=${job.employer_id}
  `;
  await sendTemplate(candidateId, 'application_confirm', { employer: emp.brand_name });
  touchAll();
  return { qualified: r.computation.qualified, score: r.computation.score, gaps: r.computation.gaps };
}

export async function actWaWithdraw(candidateId: string) {
  await withdrawConsent(candidateId, 'PROCESSING');
  await sendTemplate(candidateId, 'opt_out');
  touchAll();
}

export async function actRecomputeMatches(jobId: string) {
  const apps = await sql<{ id: string; candidate_id: string }[]>`
    SELECT id, candidate_id FROM app.application WHERE job_id = ${jobId}
  `;
  for (const a of apps) await recordMatch(a.id, a.candidate_id, jobId);
  touchAll();
}
