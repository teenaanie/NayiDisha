'use server';
import {after} from 'next/server';
import {safelyRefreshCandidate} from '@/modules/discovery';
import {authorizeAction,auditAction} from '@/lib/auth';
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
  revalidatePath('/', 'layout');
};

// ---- demo controls ---------------------------------------------------------
async function impl_actAdvanceClock(hours: number) {
  await advanceClock(hours);
  await releaseMaturedHolds();
  await expireStaleJobs();
  await (await import('./workflow-actions')).deliverDueReminders();
  touchAll();
}

async function impl_actResetClock() {
  await setClock(SEED_INSTANT);
  touchAll();
}

/** §15 stale-job row — auto-expire at 30 days, stop alerts and applications. */
async function impl_expireStaleJobs() {
  const at = await now();
  await sql`
    UPDATE app.job SET status = 'EXPIRED'
     WHERE status = 'LIVE' AND expires_at IS NOT NULL AND expires_at <= ${at}
  `;
}

// ---- operations ------------------------------------------------------------
async function impl_actPublishConfig(configId: string) {
  const at = await now();
  await publishRoleConfig(configId, 'OPS-001', at);
  touchAll();
}

async function impl_actValidateConfig(configId: string) {
  return validateRoleConfig(configId);
}

/** CFG-09 — change a sandbox configuration without deployment or migration. */
async function impl_actUpdateSandboxWeights(configId: string, weights: Record<string, number>) {
  await sql`
    UPDATE app.role_configuration SET scoring_weights = ${sql.json(weights as never)}
     WHERE id = ${configId} AND status IN ('SANDBOX','DRAFT')
  `;
  touchAll();
}

async function impl_actUpdateSandboxThreshold(configId: string, threshold: number) {
  await sql`
    UPDATE app.role_configuration
       SET assessment_threshold = ${threshold},
           qualification_rules = jsonb_set(qualification_rules, '{minAssessmentScore}', ${String(threshold)}::jsonb)
     WHERE id = ${configId} AND status IN ('SANDBOX','DRAFT')
  `;
  touchAll();
}

async function impl_actApproveEmployer(employerId: string) {
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

async function impl_actSuspendEmployer(employerId: string, reason: string) {
  const at = await now();
  await sql`
    UPDATE app.employer_organisation SET status='SUSPENDED', status_reason=${reason}, status_at=${at}
     WHERE id = ${employerId}
  `;
  // OPS-EMP-05 — pause jobs without deleting audit history.
  await sql`UPDATE app.job SET status='SUSPENDED' WHERE employer_id=${employerId} AND status='LIVE'`;
  touchAll();
}

async function impl_actApproveJob(jobId:string){
 const at=await now();
 const changed=await sql.begin(async tx=>{
 const [job]=await tx`SELECT * FROM app.job WHERE id=${jobId} FOR UPDATE`;
 if(!job||job.status!=='PENDING_APPROVAL')throw new Error('Job is not awaiting approval.');
 const [employer]=await tx`SELECT status FROM app.employer_organisation WHERE id=${job.employer_id}`;
 if(employer.status!=='VERIFIED')throw new Error('Employer must be verified.');
 const [p]=await tx`SELECT * FROM app.commercial_policy WHERE active=true`;
 if(job.expires_at&&job.expires_at<=at)throw new Error('Update the closing date before approval.');
 const expires=job.expires_at||new Date(at.getTime()+p.job_expiry_days*86400000);
 if(job.pending_changes){
 const columns:Record<string,string>={fixedPayPaise:'fixed_pay_paise',variableMaxPaise:'variable_max_paise',locationId:'location_id',shift:'shift',weeklyOff:'weekly_off',minExperienceMonths:'min_experience_mo',languages:'languages',criticalSkills:'critical_skills',openings:'openings',title:'title'};
 for(const [key,value] of Object.entries(job.pending_changes))if(columns[key]){
 await tx`UPDATE app.job SET ${tx.unsafe(columns[key])}=${Array.isArray(value)?tx.json(value):value as string|number} WHERE id=${jobId}`;
 await tx`INSERT INTO app.job_change(id,job_id,field,old_value,new_value,material,actor,notified_count,created_at) VALUES(${await nextId('JC',tx)},${jobId},${columns[key]},${JSON.stringify(job[columns[key]])},${JSON.stringify(value)},true,'OPERATIONS',0,${at})`;
 }
 }
 await tx`UPDATE app.job SET status='LIVE',pending_changes=NULL,published_at=COALESCE(published_at,${at}),expires_at=${expires},last_material_change_at=CASE WHEN ${!!job.pending_changes} THEN ${at} ELSE last_material_change_at END WHERE id=${jobId}`;
 const [existing]=await tx`SELECT id FROM app.posting_entitlement WHERE job_id=${jobId}`;
 if(!existing){
 const entId='ENT-'+jobId.slice(4);
 await tx`INSERT INTO app.posting_entitlement(id,job_id,location_id,posting_fee_paise,credits_included,max_distinct_unlocks,starts_at,ends_at,credit_expiry_at,created_at) VALUES(${entId},${jobId},${job.pending_changes?.locationId||job.location_id},${p.posting_fee_paise},${p.included_unlock_credits},${p.max_distinct_unlocks_per_job},${at},${expires},${new Date(at.getTime()+p.credit_expiry_days*86400000)},${at})`;
 await tx`INSERT INTO app.credit_ledger(id,entitlement_id,entry_type,credit_delta,amount_paise,note,created_at) VALUES(${await nextId('CRD',tx)},${entId},'INCLUDED_GRANT',${p.included_unlock_credits},${p.posting_fee_paise},'Included posting credits',${at})`;
 }
 return !!job.pending_changes;
 });
 if(changed){for(const a of await sql`SELECT candidate_id FROM app.application WHERE job_id=${jobId} AND status NOT IN ('WITHDRAWN','REJECTED')`)await sendTemplate(a.candidate_id,'job_changed',{title:jobId,change:'Updated terms approved; please reconfirm interest.'});}
 after(async()=>{await (await import('@/modules/discovery')).refreshJobCandidates(jobId);});touchAll();
}

async function impl_actRotateQr(siteId: string) {
  const [site] = await sql<{ partner_code: string }[]>`
    SELECT partner_code FROM app.partner_site WHERE id=${siteId}
  `;
  await sql`
    UPDATE app.partner_site SET qr_token = ${'qr_' + randomToken(24)}
     WHERE id = ${siteId}
  `;
  touchAll();
}

async function impl_actSetPartnerStatus(partnerId: string, status: 'VERIFIED' | 'SUSPENDED', reason: string) {
  const at = await now();
  await sql`
    UPDATE app.partner SET status=${status}, status_reason=${reason}, status_at=${at} WHERE id=${partnerId}
  `;
  if (status === 'SUSPENDED') {
    await sql`UPDATE app.partner_site SET status='SUSPENDED',suspended_by_partner=true WHERE partner_id=${partnerId} AND status='ACTIVE'`;
    // PART-10 — hold rewards with an auditable reason.
    await sql`UPDATE app.reward_ledger SET status_before_suspension=status,status='DISPUTED' WHERE partner_id=${partnerId} AND status IN ('IN_HOLD','ELIGIBLE','APPROVED')`;
  } else {
    await sql`UPDATE app.reward_ledger SET status=status_before_suspension,status_before_suspension=NULL WHERE partner_id=${partnerId} AND status='DISPUTED' AND status_before_suspension IS NOT NULL`;
    await sql`UPDATE app.partner_site SET status='ACTIVE',suspended_by_partner=false WHERE partner_id=${partnerId} AND suspended_by_partner=true`;
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, 'OPS-001', 'OPERATIONS', ${'PARTNER_' + status},
            'partner', ${partnerId}, ${reason}, ${at})
  `;
  touchAll();
}

async function impl_actResolveAttribution(attributionId: string, decision: 'ACTIVE' | 'VOID') {
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
async function impl_actUnlock(employerId: string, jobId: string, candidateId: string) {
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

async function impl_actRecordOutcome(applicationId: string, outcome: string) {
  const at = await now();
  if(!['SHORTLISTED','CONTACTED','INTERVIEW_SCHEDULED','INTERVIEW_ATTENDED','REJECTED','SELECTED','JOINED'].includes(outcome))throw new Error('Invalid recruitment stage.');const [allowed]=await sql`SELECT 1 FROM app.qualified_lead_unlock WHERE application_id=${applicationId} AND status='CONFIRMED'`;if(!allowed)throw new Error('Unlock this candidate first.');
  await sql`
    INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
    VALUES (${await nextId('OUT')}, ${applicationId}, ${outcome}, 'EU-001', 'EMPLOYER_PORTAL', ${at})
  `;
  const statusMap: Record<string, string> = {
    SHORTLISTED:'SHORTLISTED',CONTACTED: 'CONTACTED', INTERVIEW_SCHEDULED: 'INTERVIEW', INTERVIEW_ATTENDED: 'INTERVIEW',
    REJECTED: 'REJECTED', SELECTED: 'SELECTED', JOINED: 'JOINED',
  };
  if (statusMap[outcome]) {
    await sql`UPDATE app.application SET status=${statusMap[outcome]}, status_at=${at} WHERE id=${applicationId}`;
  }
  touchAll();
}

async function impl_actRaiseReplacement(unlockId: string, reason: string, evidence: string) {
  const r = await raiseReplacement(
    unlockId, reason as 'INVALID_CONTACT' | 'NEVER_APPLIED' | 'DUPLICATE_PROFILE', evidence,
  );
  touchAll();
  return r;
}

async function impl_actBuyCredits(jobId: string, count: number) {
  const at = await now();
  if(!Number.isSafeInteger(count)||count<1||count>100)throw new Error('Buy between 1 and 100 credits.');
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
async function impl_actDecideReplacement(caseId: string, decision: 'APPROVED' | 'REJECTED') {
  await decideReplacement(caseId, decision, 'OPS-001');
  touchAll();
}

// ---- finance ---------------------------------------------------------------
async function impl_actReleaseHolds() { await releaseMaturedHolds(); touchAll(); }
async function impl_actBuildBatch() { const r = await buildPayoutBatch('FIN-001'); touchAll(); return r; }
async function impl_actApprovePayout(payoutId: string) {
  const r = await approveAndExecutePayout(payoutId, 'FIN-001'); touchAll(); return r;
}

// ---- candidate / WhatsApp simulator ----------------------------------------
async function impl_actWaStart(phone: string, language: 'mr'|'hi'|'en', siteCode: string | null) {
  const reg = await startRegistration({
    phone, language, siteCode,
    method: siteCode ? (siteCode.startsWith('qr_') ? 'QR' : 'PARTNER_CODE') : 'DIRECT',
  });
  await sendTemplate(reg.candidateId, 'welcome');
  touchAll();
  return reg;
}

async function impl_actWaVerify(candidateId: string, pending: { siteId: string|null; partnerId: string|null; method: 'QR'|'PARTNER_CODE'|'DIRECT'; valid: boolean } | null) {
  await verifyAndBind(candidateId, pending);
  // Consent is recorded only through the explicit consent form.
  touchAll();
}

async function impl_actWaProfile(candidateId: string, form: {
  name: string; localityKey: string; experienceMonths: number; experienceTags: string[];
  languages: string[]; expectedPay: number; currentPay: number | null; maxCommuteMin: number; age18:boolean; shifts:string[]; workAuthorised:boolean;
}) {
  await completeProfile(candidateId, {
    name: form.name, localityKey: form.localityKey, age18: form.age18, workAuthorised:form.workAuthorised,
    experienceMonths: form.experienceMonths, experienceTags: form.experienceTags,
    languages: form.languages,
    currentPayPaise: form.currentPay === null ? null : form.currentPay * 100,
    expectedPayPaise: form.expectedPay * 100,
    maxCommuteMin: form.maxCommuteMin, shiftAvailability: form.shifts,
  });
  touchAll();
}

async function impl_actWaAssessment(candidateId: string, templateId: string, answers: Record<string, string>) {
  const r = await recordAssessment(candidateId, templateId, answers);
  touchAll();
  return r;
}

/**
 * END-01 — the candidate sends an invitation. It is the endorser who submits,
 * on their own no-login page at /endorse/<token>, after verifying a channel.
 * The link is returned here only so the demo can open it in another tab.
 */
async function impl_actWaEndorse(candidateId: string, endorserName: string, contact: string, relationship: string) {
  const inv = await createEndorsementInvite(candidateId, endorserName, contact, relationship);
  touchAll();
  return { id: inv.id, token: inv.token, link: `/endorse/${inv.token}` };
}

async function impl_actWaApply(candidateId: string, jobId: string) {
  const r = await applyAndEvaluate(candidateId, jobId, false);
  const [job] = await sql<{ employer_id: string }[]>`SELECT employer_id FROM app.job WHERE id=${jobId}`;
  const [emp] = await sql<{ brand_name: string }[]>`
    SELECT brand_name FROM app.employer_organisation WHERE id=${job.employer_id}
  `;
  await sendTemplate(candidateId, 'application_confirm', { employer: emp.brand_name });
  touchAll();
  return { qualified: r.computation.qualified, score: r.computation.score, gaps: r.computation.gaps };
}

async function impl_actWaWithdraw(candidateId: string) {
  await withdrawConsent(candidateId, 'PROCESSING');
  await sendTemplate(candidateId, 'opt_out');
  touchAll();
}

async function impl_actRecomputeMatches(jobId: string) {
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
async function impl_actCreateEmployer(input: NewEmployerInput) {
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
async function impl_actCreatePartner(input: NewPartnerInput) {
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
  attributes: Record<string, string>; description?:string;preferredSkills?:string;workMode?:string;qualification?:string;closingDate?:string;draft?:boolean;
}

/**
 * JOB-01/02/08 — draft and submit a job.
 *
 * Created as PENDING_APPROVAL because JOB-02 requires operations approval
 * during the pilot. Approving it (Operations console) is what publishes it and
 * creates the posting entitlement with its included credits.
 */
async function impl_actCreateJob(input: NewJobInput) {
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

  const [location]=await sql`SELECT id FROM app.employer_location WHERE id=${input.locationId} AND employer_id=${input.employerId}`;
  if(!location)return {error:'LOCATION_OUTSIDE_ORGANISATION'};
  if(!input.title.trim()||!input.shift.trim()||!input.languages.length||input.languages.some(l=>!['en','hi','mr'].includes(l)))return {error:'COMPLETE_REQUIRED_JOB_DETAILS'};
  if(![input.openings,input.minExperienceMonths].every(n=>Number.isSafeInteger(n)&&n>=0)||![input.fixedPayRupees,input.variableMaxRupees].every(n=>Number.isFinite(n)&&n>=0))return {error:'INVALID_NUMBER'};
  const [configuration]=await sql`SELECT job_attributes FROM app.role_configuration WHERE id=${input.roleConfigId}`;
  for(const field of configuration.job_attributes){
   const val=input.attributes[field.key];
   if(field.required&&(val===undefined||val===null||val===''))return {error:'REQUIRED_FIELD_'+field.key};
   const [def]=await sql`SELECT data_type,allowed_values FROM app.attribute_definition WHERE key=${field.key}`;
   if(val!==undefined && def && ((def.data_type==='ENUM'&&!def.allowed_values.includes(val))||(def.data_type==='INT'&&!Number.isSafeInteger(Number(val)))||(def.data_type==='BOOL'&&!['true','false',true,false].includes(val as any))))return {error:'INVALID_FIELD_'+field.key};
  }
  const closing=input.closingDate?new Date(input.closingDate):null;if(closing&&(!Number.isFinite(closing.getTime())||closing<=at))return {error:'CLOSING_DATE_MUST_BE_IN_FUTURE'};if(input.workMode&&!['ONSITE','HYBRID','REMOTE'].includes(input.workMode))return {error:'INVALID_WORK_MODE'};
  const jobId = await nextId('JOB');
  await sql`
    INSERT INTO app.job
      (id, employer_id, location_id, role_config_id, title, openings,
       fixed_pay_paise, variable_max_paise, shift, weekly_off, languages,
       min_experience_mo, critical_skills, attributes, status, created_at,description,preferred_skills,work_mode,qualification,expires_at)
    VALUES (${jobId}, ${input.employerId}, ${input.locationId}, ${input.roleConfigId},
            ${input.title}, ${input.openings},
            ${Math.round(input.fixedPayRupees * 100)}, ${Math.round(input.variableMaxRupees * 100)},
            ${input.shift}, ${input.weeklyOff || null}, ${sql.json(input.languages as never)},
            ${input.minExperienceMonths}, ${sql.json(input.criticalSkills as never)},
            ${sql.json(input.attributes as never)}, ${input.draft?'DRAFT':'PENDING_APPROVAL'}, ${at},${input.description||''},${input.preferredSkills||''},${input.workMode||'ONSITE'},${input.qualification||''},${closing})
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
async function impl_actCreateLocation(
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
async function impl_actDispatchAlerts(jobId: string) {
  const r = await dispatchJobAlerts(jobId); touchAll(); return r;
}
async function impl_actRespondToAlert(alertId: string, response: string) {
  await respondToAlert(alertId, response as 'VIEW' | 'APPLY' | 'NOT_INTERESTED' | 'STOP_ALERTS' | 'CHANGE_PREFERENCES');
  touchAll();
}
async function impl_actSendNudge(partnerId: string, candidateId: string, jobId: string) {
  const r = await sendNudge(partnerId, candidateId, jobId); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Interviews (§8.9)
// ---------------------------------------------------------------------------
async function impl_actProposeInterview(
  applicationId: string, whenIso: string, format: string, locationNote: string, safetyNote: string,
) {
  const r = await proposeInterview(applicationId, new Date(whenIso), format, locationNote, safetyNote);
  touchAll(); return r;
}
async function impl_actRespondInterview(interviewId: string, confirmed: boolean) {
  const r = await respondToInterview(interviewId, confirmed); touchAll(); return r;
}
async function impl_actRescheduleInterview(interviewId: string, whenIso: string) {
  const r = await rescheduleInterview(interviewId, new Date(whenIso)); touchAll(); return r;
}
async function impl_actInterviewOutcome(interviewId: string, outcome: string, note?: string) {
  const r = await recordInterviewOutcome(
    interviewId, outcome as 'ATTENDED' | 'NO_SHOW_CANDIDATE' | 'NO_SHOW_EMPLOYER' | 'CANCELLED', note);
  touchAll(); return r;
}
async function impl_actSendInterviewReminders() {
  const n = await sendDueInterviewReminders(); touchAll(); return { sent: n };
}

// ---------------------------------------------------------------------------
// Selection and onboarding (§8.10)
// ---------------------------------------------------------------------------
async function impl_actMakeOffer(input: {
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
async function impl_actRespondOffer(caseId: string, accepted: boolean) {
  const r = await respondToOffer(caseId, accepted); touchAll(); return r;
}
async function impl_actUploadDocument(documentId: string) {
  const r = await uploadDocument(documentId); touchAll(); return r;
}
async function impl_actReviewDocument(documentId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
  const r = await reviewDocument(documentId, decision, reason); touchAll(); return r;
}
async function impl_actMarkJoined(caseId: string) {
  const r = await markJoined(caseId); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Job lifecycle (JOB-01/04/05)
// ---------------------------------------------------------------------------
async function impl_actEditJob(jobId: string, edit: JobEdit) {
  const r = await editJob(jobId, edit, 'EU-001'); touchAll(); return r;
}
async function impl_actSetJobState(jobId: string, state: string, reason: string) {
  const r = await setJobState(
    jobId, state as 'LIVE' | 'PAUSED' | 'FILLED' | 'CLOSED' | 'ARCHIVED', reason, 'EU-001');
  touchAll(); return r;
}
async function impl_actDuplicateJob(jobId: string) {
  const r = await duplicateJob(jobId, 'EU-001'); touchAll(); return r;
}

// ---------------------------------------------------------------------------
// Endorsements (END-02/03/09) and candidate self-service (CAN-02/04/06)
// ---------------------------------------------------------------------------
async function impl_actCreateEndorsementInvite(
  candidateId: string, name: string, contact: string, relationship: string,
) {
  const r = await createEndorsementInvite(candidateId, name, contact, relationship);
  touchAll(); return r;
}
async function impl_actSubmitEndorsement(token: string, input: {
  relationship: string; periodKnown: string; competencies: string[];
  comment: string; displayConsent: boolean; otp: string;
}) {
  const r = await submitEndorsement(token, input); touchAll(); return r;
}
async function impl_actWithdrawEndorsement(withdrawToken: string) {
  const r = await withdrawEndorsement(withdrawToken); touchAll(); return r;
}
async function impl_actHideEndorsement(endorsementId: string, hidden: boolean) {
  const r = await setEndorsementHidden(endorsementId, hidden); touchAll(); return r;
}
async function impl_actUpdatePreferences(candidateId: string, prefs: {
  language?: 'mr' | 'hi' | 'en'; maxCommuteMin?: number; expectedPayPaise?: number;
  alertQuietFrom?: number; alertQuietTo?: number; alertMaxPerWeek?: number;
}) {
  const r = await updatePreferences(candidateId, prefs);after(()=>safelyRefreshCandidate(candidateId)); touchAll(); return r;
}
async function impl_actRaiseDataRequest(candidateId: string, kind: string, detail: string) {
  const r = await raiseDataRequest(candidateId, kind as 'ACCESS' | 'CORRECTION' | 'ERASURE', detail);
  touchAll(); return r;
}
async function impl_actResolveDataRequest(id: string, status: 'ACTIONED' | 'REFUSED', correction?:{field:string;value:string;reason:string}) {
  const r = await resolveDataRequest(id, status, correction); touchAll(); return r;
}
async function impl_actAcceptConduct(partnerId: string) {
  const r = await acceptConduct(partnerId); touchAll(); return r;
}

export async function actAdvanceClock(...args:Parameters<typeof impl_actAdvanceClock>){await authorizeAction('actAdvanceClock',args);const result=await impl_actAdvanceClock(...args);await auditAction('actAdvanceClock',args);return result;}
export async function actResetClock(...args:Parameters<typeof impl_actResetClock>){await authorizeAction('actResetClock',args);const result=await impl_actResetClock(...args);await auditAction('actResetClock',args);return result;}
export async function expireStaleJobs(...args:Parameters<typeof impl_expireStaleJobs>){await authorizeAction('expireStaleJobs',args);const result=await impl_expireStaleJobs(...args);await auditAction('expireStaleJobs',args);return result;}
export async function actPublishConfig(...args:Parameters<typeof impl_actPublishConfig>){await authorizeAction('actPublishConfig',args);const result=await impl_actPublishConfig(...args);await auditAction('actPublishConfig',args);return result;}
export async function actValidateConfig(...args:Parameters<typeof impl_actValidateConfig>){await authorizeAction('actValidateConfig',args);const result=await impl_actValidateConfig(...args);await auditAction('actValidateConfig',args);return result;}
export async function actUpdateSandboxWeights(...args:Parameters<typeof impl_actUpdateSandboxWeights>){await authorizeAction('actUpdateSandboxWeights',args);const result=await impl_actUpdateSandboxWeights(...args);await auditAction('actUpdateSandboxWeights',args);return result;}
export async function actUpdateSandboxThreshold(...args:Parameters<typeof impl_actUpdateSandboxThreshold>){await authorizeAction('actUpdateSandboxThreshold',args);const result=await impl_actUpdateSandboxThreshold(...args);await auditAction('actUpdateSandboxThreshold',args);return result;}
export async function actApproveEmployer(...args:Parameters<typeof impl_actApproveEmployer>){await authorizeAction('actApproveEmployer',args);const result=await impl_actApproveEmployer(...args);await auditAction('actApproveEmployer',args);return result;}
export async function actSuspendEmployer(...args:Parameters<typeof impl_actSuspendEmployer>){await authorizeAction('actSuspendEmployer',args);const result=await impl_actSuspendEmployer(...args);await auditAction('actSuspendEmployer',args);return result;}
export async function actApproveJob(...args:Parameters<typeof impl_actApproveJob>){await authorizeAction('actApproveJob',args);const result=await impl_actApproveJob(...args);await auditAction('actApproveJob',args);return result;}
export async function actRotateQr(...args:Parameters<typeof impl_actRotateQr>){await authorizeAction('actRotateQr',args);const result=await impl_actRotateQr(...args);await auditAction('actRotateQr',args);return result;}
export async function actSetPartnerStatus(...args:Parameters<typeof impl_actSetPartnerStatus>){await authorizeAction('actSetPartnerStatus',args);const result=await impl_actSetPartnerStatus(...args);await auditAction('actSetPartnerStatus',args);return result;}
export async function actResolveAttribution(...args:Parameters<typeof impl_actResolveAttribution>){await authorizeAction('actResolveAttribution',args);const result=await impl_actResolveAttribution(...args);await auditAction('actResolveAttribution',args);return result;}
export async function actUnlock(...args:Parameters<typeof impl_actUnlock>){await authorizeAction('actUnlock',args);const result=await impl_actUnlock(...args);await auditAction('actUnlock',args);return result;}
export async function actRecordOutcome(...args:Parameters<typeof impl_actRecordOutcome>){await authorizeAction('actRecordOutcome',args);const result=await impl_actRecordOutcome(...args);await auditAction('actRecordOutcome',args);return result;}
export async function actRaiseReplacement(...args:Parameters<typeof impl_actRaiseReplacement>){await authorizeAction('actRaiseReplacement',args);const result=await impl_actRaiseReplacement(...args);await auditAction('actRaiseReplacement',args);return result;}
export async function actBuyCredits(...args:Parameters<typeof impl_actBuyCredits>){await authorizeAction('actBuyCredits',args);const result=await impl_actBuyCredits(...args);await auditAction('actBuyCredits',args);return result;}
export async function actDecideReplacement(...args:Parameters<typeof impl_actDecideReplacement>){await authorizeAction('actDecideReplacement',args);const result=await impl_actDecideReplacement(...args);await auditAction('actDecideReplacement',args);return result;}
export async function actReleaseHolds(...args:Parameters<typeof impl_actReleaseHolds>){await authorizeAction('actReleaseHolds',args);const result=await impl_actReleaseHolds(...args);await auditAction('actReleaseHolds',args);return result;}
export async function actBuildBatch(...args:Parameters<typeof impl_actBuildBatch>){await authorizeAction('actBuildBatch',args);const result=await impl_actBuildBatch(...args);await auditAction('actBuildBatch',args);return result;}
export async function actApprovePayout(...args:Parameters<typeof impl_actApprovePayout>){await authorizeAction('actApprovePayout',args);const result=await impl_actApprovePayout(...args);await auditAction('actApprovePayout',args);return result;}
export async function actWaStart(...args:Parameters<typeof impl_actWaStart>){await authorizeAction('actWaStart',args);const result=await impl_actWaStart(...args);await auditAction('actWaStart',args);return result;}
export async function actWaVerify(...args:Parameters<typeof impl_actWaVerify>){await authorizeAction('actWaVerify',args);const result=await impl_actWaVerify(...args);await auditAction('actWaVerify',args);return result;}
export async function actWaProfile(...args:Parameters<typeof impl_actWaProfile>){await authorizeAction('actWaProfile',args);const result=await impl_actWaProfile(...args);await auditAction('actWaProfile',args);return result;}
export async function actWaAssessment(...args:Parameters<typeof impl_actWaAssessment>){await authorizeAction('actWaAssessment',args);const result=await impl_actWaAssessment(...args);await auditAction('actWaAssessment',args);return result;}
export async function actWaEndorse(...args:Parameters<typeof impl_actWaEndorse>){await authorizeAction('actWaEndorse',args);const result=await impl_actWaEndorse(...args);await auditAction('actWaEndorse',args);return result;}
export async function actWaApply(...args:Parameters<typeof impl_actWaApply>){await authorizeAction('actWaApply',args);const result=await impl_actWaApply(...args);await auditAction('actWaApply',args);return result;}
export async function actWaWithdraw(...args:Parameters<typeof impl_actWaWithdraw>){await authorizeAction('actWaWithdraw',args);const result=await impl_actWaWithdraw(...args);await auditAction('actWaWithdraw',args);return result;}
export async function actRecomputeMatches(...args:Parameters<typeof impl_actRecomputeMatches>){await authorizeAction('actRecomputeMatches',args);const result=await impl_actRecomputeMatches(...args);await auditAction('actRecomputeMatches',args);return result;}
export async function actCreateEmployer(...args:Parameters<typeof impl_actCreateEmployer>){await authorizeAction('actCreateEmployer',args);const result=await impl_actCreateEmployer(...args);await auditAction('actCreateEmployer',args);return result;}
export async function actCreatePartner(...args:Parameters<typeof impl_actCreatePartner>){await authorizeAction('actCreatePartner',args);const result=await impl_actCreatePartner(...args);await auditAction('actCreatePartner',args);return result;}
export async function actCreateJob(...args:Parameters<typeof impl_actCreateJob>){await authorizeAction('actCreateJob',args);const result=await impl_actCreateJob(...args);await auditAction('actCreateJob',args);return result;}
export async function actCreateLocation(...args:Parameters<typeof impl_actCreateLocation>){await authorizeAction('actCreateLocation',args);const result=await impl_actCreateLocation(...args);await auditAction('actCreateLocation',args);return result;}
export async function actDispatchAlerts(...args:Parameters<typeof impl_actDispatchAlerts>){await authorizeAction('actDispatchAlerts',args);const result=await impl_actDispatchAlerts(...args);await auditAction('actDispatchAlerts',args);return result;}
export async function actRespondToAlert(...args:Parameters<typeof impl_actRespondToAlert>){await authorizeAction('actRespondToAlert',args);const result=await impl_actRespondToAlert(...args);await auditAction('actRespondToAlert',args);return result;}
export async function actSendNudge(...args:Parameters<typeof impl_actSendNudge>){await authorizeAction('actSendNudge',args);const result=await impl_actSendNudge(...args);await auditAction('actSendNudge',args);return result;}
export async function actProposeInterview(...args:Parameters<typeof impl_actProposeInterview>){await authorizeAction('actProposeInterview',args);const result=await impl_actProposeInterview(...args);await auditAction('actProposeInterview',args);return result;}
export async function actRespondInterview(...args:Parameters<typeof impl_actRespondInterview>){await authorizeAction('actRespondInterview',args);const result=await impl_actRespondInterview(...args);await auditAction('actRespondInterview',args);return result;}
export async function actRescheduleInterview(...args:Parameters<typeof impl_actRescheduleInterview>){await authorizeAction('actRescheduleInterview',args);const result=await impl_actRescheduleInterview(...args);await auditAction('actRescheduleInterview',args);return result;}
export async function actInterviewOutcome(...args:Parameters<typeof impl_actInterviewOutcome>){await authorizeAction('actInterviewOutcome',args);const result=await impl_actInterviewOutcome(...args);await auditAction('actInterviewOutcome',args);return result;}
export async function actSendInterviewReminders(...args:Parameters<typeof impl_actSendInterviewReminders>){await authorizeAction('actSendInterviewReminders',args);const result=await impl_actSendInterviewReminders(...args);await auditAction('actSendInterviewReminders',args);return result;}
export async function actMakeOffer(...args:Parameters<typeof impl_actMakeOffer>){await authorizeAction('actMakeOffer',args);const result=await impl_actMakeOffer(...args);await auditAction('actMakeOffer',args);return result;}
export async function actRespondOffer(...args:Parameters<typeof impl_actRespondOffer>){await authorizeAction('actRespondOffer',args);const result=await impl_actRespondOffer(...args);await auditAction('actRespondOffer',args);return result;}
export async function actUploadDocument(...args:Parameters<typeof impl_actUploadDocument>){await authorizeAction('actUploadDocument',args);const result=await impl_actUploadDocument(...args);await auditAction('actUploadDocument',args);return result;}
export async function actReviewDocument(...args:Parameters<typeof impl_actReviewDocument>){await authorizeAction('actReviewDocument',args);const result=await impl_actReviewDocument(...args);await auditAction('actReviewDocument',args);return result;}
export async function actMarkJoined(...args:Parameters<typeof impl_actMarkJoined>){await authorizeAction('actMarkJoined',args);const result=await impl_actMarkJoined(...args);await auditAction('actMarkJoined',args);return result;}
export async function actEditJob(...args:Parameters<typeof impl_actEditJob>){await authorizeAction('actEditJob',args);const result=await impl_actEditJob(...args);await auditAction('actEditJob',args);return result;}
export async function actSetJobState(...args:Parameters<typeof impl_actSetJobState>){await authorizeAction('actSetJobState',args);const result=await impl_actSetJobState(...args);await auditAction('actSetJobState',args);return result;}
export async function actDuplicateJob(...args:Parameters<typeof impl_actDuplicateJob>){await authorizeAction('actDuplicateJob',args);const result=await impl_actDuplicateJob(...args);await auditAction('actDuplicateJob',args);return result;}
export async function actCreateEndorsementInvite(...args:Parameters<typeof impl_actCreateEndorsementInvite>){await authorizeAction('actCreateEndorsementInvite',args);const result=await impl_actCreateEndorsementInvite(...args);await auditAction('actCreateEndorsementInvite',args);return result;}
export async function actSubmitEndorsement(...args:Parameters<typeof impl_actSubmitEndorsement>){const result=await impl_actSubmitEndorsement(...args);await auditAction('actSubmitEndorsement',args);return result;}
export async function actWithdrawEndorsement(...args:Parameters<typeof impl_actWithdrawEndorsement>){const result=await impl_actWithdrawEndorsement(...args);await auditAction('actWithdrawEndorsement',args);return result;}
export async function actHideEndorsement(...args:Parameters<typeof impl_actHideEndorsement>){await authorizeAction('actHideEndorsement',args);const result=await impl_actHideEndorsement(...args);await auditAction('actHideEndorsement',args);return result;}
export async function actUpdatePreferences(...args:Parameters<typeof impl_actUpdatePreferences>){await authorizeAction('actUpdatePreferences',args);const result=await impl_actUpdatePreferences(...args);await auditAction('actUpdatePreferences',args);return result;}
export async function actRaiseDataRequest(...args:Parameters<typeof impl_actRaiseDataRequest>){await authorizeAction('actRaiseDataRequest',args);const result=await impl_actRaiseDataRequest(...args);await auditAction('actRaiseDataRequest',args);return result;}
export async function actResolveDataRequest(...args:Parameters<typeof impl_actResolveDataRequest>){await authorizeAction('actResolveDataRequest',args);const result=await impl_actResolveDataRequest(...args);await auditAction('actResolveDataRequest',args);return result;}
export async function actAcceptConduct(...args:Parameters<typeof impl_actAcceptConduct>){await authorizeAction('actAcceptConduct',args);const result=await impl_actAcceptConduct(...args);await auditAction('actAcceptConduct',args);return result;}
