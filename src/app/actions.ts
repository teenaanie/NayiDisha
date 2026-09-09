'use server';
import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { now, advanceClock, setClock, SEED_INSTANT } from '@/lib/clock';
import { nextId, randomToken } from '@/lib/ids';
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
import { dispatchJobAlerts, respondToAlert, sendNudge } from '@/modules/alerts';
import {
  proposeInterview, respondToInterview, rescheduleInterview, recordInterviewOutcome,
  sendDueInterviewReminders, makeOffer, respondToOffer, uploadDocument, reviewDocument,
  markJoined,
} from '@/modules/hiring';
import {
  editJob, setJobState, duplicateJob, JobEdit,
  createEndorsementInvite, submitEndorsement, withdrawEndorsement, setEndorsementHidden,
  updatePreferences, raiseDataRequest, resolveDataRequest, acceptConduct,
} from '@/modules/lifecycle';

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
  // ALT-01 — publishing is what triggers alerts to eligible candidates and
  // relevant partners. Nothing is broadcast before approval.
  await dispatchJobAlerts(jobId);
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

/**
 * END-01 — the candidate sends an invitation. It is the endorser who submits,
 * on their own no-login page at /endorse/<token>, after verifying a channel.
 * The link is returned here only so the demo can open it in another tab.
 */
export async function actWaEndorse(candidateId: string, endorserName: string, contact: string, relationship: string) {
  const inv = await createEndorsementInvite(candidateId, endorserName, contact, relationship);
  touchAll();
  return { id: inv.id, token: inv.token, link: `/endorse/${inv.token}` };
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

// ---------------------------------------------------------------------------
// Creation flows (OPS-EMP-01, PART-01/04, JOB-01)
// ---------------------------------------------------------------------------

export interface NewEmployerInput {
  legalName: string; brandName: string; gstPan: string; billingContact: string;
  locationName: string; localityKey: string; hours: string;
  adminName: string;
}

/**
 * OPS-EMP-01 — operations creates an employer. An organisation is useless
 * without somewhere to hire and someone to log in, so the first location and
 * administrator are created in the same transaction.
 *
 * Created as PENDING_REVIEW: verification is a separate, auditable act, and
 * OPS-EMP-04 only lets verified direct employers post jobs.
 */
export async function actCreateEmployer(input: NewEmployerInput) {
  const at = await now();
  return sql.begin(async (tx) => {
    const empId = await nextId('EMP', tx);
    const locId = await nextId('LOC', tx);
    const userId = await nextId('EU', tx);

    const [loc] = await tx<{ lat: number; lng: number }[]>`
      SELECT lat, lng FROM app.locality WHERE key = ${input.localityKey}
    `;
    if (!loc) return { error: 'UNKNOWN_LOCALITY' };

    await tx`
      INSERT INTO app.employer_organisation
        (id, legal_name, brand_name, gst_pan, billing_contact, status, created_at, status_at)
      VALUES (${empId}, ${input.legalName}, ${input.brandName}, ${input.gstPan || null},
              ${input.billingContact || null}, 'PENDING_REVIEW', ${at}, ${at})
    `;
    await tx`
      INSERT INTO app.employer_location
        (id, employer_id, name, locality_key, lat, lng, hours, created_at)
      VALUES (${locId}, ${empId}, ${input.locationName}, ${input.localityKey},
              ${loc.lat}, ${loc.lng}, ${input.hours || null}, ${at})
    `;
    await tx`
      INSERT INTO app.employer_user (id, employer_id, name, role, location_scope, created_at)
      VALUES (${userId}, ${empId}, ${input.adminName}, 'COMPANY_ADMIN', ${sql.json([] as never)}, ${at})
    `;
    await tx`
      INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
      VALUES (${await nextId('AUD', tx)}, 'OPS-001', 'OPERATIONS', 'EMPLOYER_CREATED',
              'employer_organisation', ${empId}, 'OPS-EMP-01',
              ${sql.json({ locId, userId } as never)}, ${at})
    `;
    touchAll();
    return { employerId: empId, locationId: locId, userId };
  });
}

export interface NewPartnerInput {
  name: string; partnerType: string; isBusiness: boolean;
  capabilities: string[]; localityKey: string; languages: string[];
  pan: string; payoutUpi: string;
}

/** PART-01/04/05 — create a partner with its first verified site, QR and code. */
export async function actCreatePartner(input: NewPartnerInput) {
  const at = await now();
  const parId = await nextId('PAR');
  const siteId = await nextId('SITE');

  // A short, speakable code derived from the trading name — this is what gets
  // printed under the QR for anyone whose scan fails (PART-05).
  const initials = input.name.replace(/^DEMO\s+/i, '')
    .split(/\s+/).map((w) => w[0]).join('').replace(/[^A-Za-z]/g, '')
    .toUpperCase().slice(0, 3).padEnd(3, 'X');
  let code = '';
  for (let n = 101; n < 999; n++) {
    const candidate = `${initials}${n}`;
    const [clash] = await sql<{ id: string }[]>`
      SELECT id FROM app.partner_site WHERE partner_code = ${candidate}
    `;
    if (!clash) { code = candidate; break; }
  }
  if (!code) return { error: 'COULD_NOT_ALLOCATE_CODE' };

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app.partner
        (id, name, partner_type, is_business, capabilities, service_localities, languages,
         pan, payout_upi, status, created_at, status_at)
      VALUES (${parId}, ${input.name}, ${input.partnerType}, ${input.isBusiness},
              ${sql.json(input.capabilities as never)}, ${sql.json([input.localityKey] as never)},
              ${sql.json(input.languages as never)}, ${input.pan || null},
              ${input.payoutUpi || null}, 'PENDING_REVIEW', ${at}, ${at})
    `;
    await tx`
      INSERT INTO app.partner_site
        (id, partner_id, locality_key, partner_code, qr_token, status, created_at)
      VALUES (${siteId}, ${parId}, ${input.localityKey}, ${code},
              ${'qr_' + code + '_' + randomToken(5)}, 'ACTIVE', ${at})
    `;
    await tx`
      INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
      VALUES (${await nextId('AUD', tx)}, 'OPS-001', 'OPERATIONS', 'PARTNER_CREATED',
              'partner', ${parId}, 'PART-01', ${sql.json({ siteId, code } as never)}, ${at})
    `;
  });
  touchAll();
  return { partnerId: parId, siteId, partnerCode: code };
}

export interface NewJobInput {
  employerId: string; locationId: string; roleConfigId: string;
  title: string; openings: number;
  fixedPayRupees: number; variableMaxRupees: number;
  shift: string; weeklyOff: string; languages: string[];
  minExperienceMonths: number; criticalSkills: string[];
  attributes: Record<string, string>;
}

/**
 * JOB-01/02/08 — draft and submit a job.
 *
 * Created as PENDING_APPROVAL because JOB-02 requires operations approval
 * during the pilot. Approving it (Operations console) is what publishes it and
 * creates the posting entitlement with its included credits.
 */
export async function actCreateJob(input: NewJobInput) {
  const at = await now();

  const [emp] = await sql<{ status: string }[]>`
    SELECT status FROM app.employer_organisation WHERE id = ${input.employerId}
  `;
  if (!emp) return { error: 'EMPLOYER_NOT_FOUND' };
  // OPS-EMP-04 — only verified direct employers may post.
  if (emp.status !== 'VERIFIED') return { error: 'EMPLOYER_NOT_VERIFIED' };

  const [cfg] = await sql<{ status: string }[]>`
    SELECT status FROM app.role_configuration WHERE id = ${input.roleConfigId}
  `;
  if (!cfg) return { error: 'CONFIG_NOT_FOUND' };
  // JOB-09 — only active configurations enabled for this organisation.
  if (cfg.status !== 'PUBLISHED') return { error: 'CONFIG_NOT_PUBLISHED' };

  if (input.fixedPayRupees <= 0) return { error: 'FIXED_PAY_REQUIRED' };
  if (input.openings <= 0) return { error: 'OPENINGS_REQUIRED' };

  const jobId = await nextId('JOB');
  await sql`
    INSERT INTO app.job
      (id, employer_id, location_id, role_config_id, title, openings,
       fixed_pay_paise, variable_max_paise, shift, weekly_off, languages,
       min_experience_mo, critical_skills, attributes, status, created_at)
    VALUES (${jobId}, ${input.employerId}, ${input.locationId}, ${input.roleConfigId},
            ${input.title}, ${input.openings},
            ${Math.round(input.fixedPayRupees * 100)}, ${Math.round(input.variableMaxRupees * 100)},
            ${input.shift}, ${input.weeklyOff || null}, ${sql.json(input.languages as never)},
            ${input.minExperienceMonths}, ${sql.json(input.criticalSkills as never)},
            ${sql.json(input.attributes as never)}, 'PENDING_APPROVAL', ${at})
  `;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, 'EU-001', 'EMPLOYER', 'JOB_SUBMITTED', 'job', ${jobId},
            'JOB-01/02 — awaiting operations approval', ${sql.json({ title: input.title } as never)}, ${at})
  `;
  touchAll();
  return { jobId };
}

/** Add a further location to an existing employer, so jobs can be posted for it. */
export async function actCreateLocation(
  employerId: string, name: string, localityKey: string, hours: string,
) {
  const at = await now();
  const [loc] = await sql<{ lat: number; lng: number }[]>`
    SELECT lat, lng FROM app.locality WHERE key = ${localityKey}
  `;
  if (!loc) return { error: 'UNKNOWN_LOCALITY' };
  const locId = await nextId('LOC');
  await sql`
    INSERT INTO app.employer_location
      (id, employer_id, name, locality_key, lat, lng, hours, created_at)
    VALUES (${locId}, ${employerId}, ${name}, ${localityKey}, ${loc.lat}, ${loc.lng},
            ${hours || null}, ${at})
  `;
  touchAll();
  return { locationId: locId };
}

// ---------------------------------------------------------------------------
// Alerts and nudges (§8.6)
// ---------------------------------------------------------------------------
export async function actDispatchAlerts(jobId: string) {
  const r = await dispatchJobAlerts(jobId); touchAll(); return r;
}
export async function actRespondToAlert(alertId: string, response: string) {
  await respondToAlert(alertId, response as 'VIEW' | 'APPLY' | 'NOT_INTERESTED' | 'STOP_ALERTS' | 'CHANGE_PREFERENCES');
  touchAll();
}
export async function actSendNudge(partnerId: string, candidateId: string, jobId: string) {
  const r = await sendNudge(partnerId, candidateId, jobId); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Interviews (§8.9)
// ---------------------------------------------------------------------------
export async function actProposeInterview(
  applicationId: string, whenIso: string, format: string, locationNote: string, safetyNote: string,
) {
  const r = await proposeInterview(applicationId, new Date(whenIso), format, locationNote, safetyNote);
  touchAll(); return r;
}
export async function actRespondInterview(interviewId: string, confirmed: boolean) {
  const r = await respondToInterview(interviewId, confirmed); touchAll(); return r;
}
export async function actRescheduleInterview(interviewId: string, whenIso: string) {
  const r = await rescheduleInterview(interviewId, new Date(whenIso)); touchAll(); return r;
}
export async function actInterviewOutcome(interviewId: string, outcome: string, note?: string) {
  const r = await recordInterviewOutcome(
    interviewId, outcome as 'ATTENDED' | 'NO_SHOW_CANDIDATE' | 'NO_SHOW_EMPLOYER' | 'CANCELLED', note);
  touchAll(); return r;
}
export async function actSendInterviewReminders() {
  const n = await sendDueInterviewReminders(); touchAll(); return { sent: n };
}

// ---------------------------------------------------------------------------
// Selection and onboarding (§8.10)
// ---------------------------------------------------------------------------
export async function actMakeOffer(input: {
  applicationId: string; roleTitle: string; locationId: string;
  fixedRupees: number; variableRupees: number; joiningDate: string; offerValidHours: number;
}) {
  const r = await makeOffer({
    applicationId: input.applicationId, roleTitle: input.roleTitle, locationId: input.locationId,
    fixedPaise: Math.round(input.fixedRupees * 100),
    variablePaise: Math.round(input.variableRupees * 100),
    joiningDate: input.joiningDate, offerValidHours: input.offerValidHours,
  });
  touchAll(); return r;
}
export async function actRespondOffer(caseId: string, accepted: boolean) {
  const r = await respondToOffer(caseId, accepted); touchAll(); return r;
}
export async function actUploadDocument(documentId: string) {
  const r = await uploadDocument(documentId); touchAll(); return r;
}
export async function actReviewDocument(documentId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
  const r = await reviewDocument(documentId, decision, reason); touchAll(); return r;
}
export async function actMarkJoined(caseId: string) {
  const r = await markJoined(caseId); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Job lifecycle (JOB-01/04/05)
// ---------------------------------------------------------------------------
export async function actEditJob(jobId: string, edit: JobEdit) {
  const r = await editJob(jobId, edit, 'EU-001'); touchAll(); return r;
}
export async function actSetJobState(jobId: string, state: string, reason: string) {
  const r = await setJobState(
    jobId, state as 'LIVE' | 'PAUSED' | 'FILLED' | 'CLOSED' | 'ARCHIVED', reason, 'EU-001');
  touchAll(); return r;
}
export async function actDuplicateJob(jobId: string) {
  const r = await duplicateJob(jobId, 'EU-001'); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Endorsements (END-02/03/09) and candidate self-service (CAN-02/04/06)
// ---------------------------------------------------------------------------
export async function actCreateEndorsementInvite(
  candidateId: string, name: string, contact: string, relationship: string,
) {
  const r = await createEndorsementInvite(candidateId, name, contact, relationship);
  touchAll(); return r;
}
export async function actSubmitEndorsement(token: string, input: {
  relationship: string; periodKnown: string; competencies: string[];
  comment: string; displayConsent: boolean; otp: string;
}) {
  const r = await submitEndorsement(token, input); touchAll(); return r;
}
export async function actWithdrawEndorsement(withdrawToken: string) {
  const r = await withdrawEndorsement(withdrawToken); touchAll(); return r;
}
export async function actHideEndorsement(endorsementId: string, hidden: boolean) {
  const r = await setEndorsementHidden(endorsementId, hidden); touchAll(); return r;
}
export async function actUpdatePreferences(candidateId: string, prefs: {
  language?: 'mr' | 'hi' | 'en'; maxCommuteMin?: number; expectedPayPaise?: number;
  alertQuietFrom?: number; alertQuietTo?: number; alertMaxPerWeek?: number;
}) {
  const r = await updatePreferences(candidateId, prefs); touchAll(); return r;
}
export async function actRaiseDataRequest(candidateId: string, kind: string, detail: string) {
  const r = await raiseDataRequest(candidateId, kind as 'ACCESS' | 'CORRECTION' | 'ERASURE', detail);
  touchAll(); return r;
}
export async function actResolveDataRequest(id: string, status: 'ACTIONED' | 'REFUSED') {
  const r = await resolveDataRequest(id, status); touchAll(); return r;
}
export async function actAcceptConduct(partnerId: string) {
  const r = await acceptConduct(partnerId); touchAll(); return r;
}
