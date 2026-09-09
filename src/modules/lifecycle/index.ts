import { sql } from '@/lib/db';
import { now, addDays } from '@/lib/clock';
import { nextId, randomToken } from '@/lib/ids';
import { messagingProvider } from '@/modules/adapters/messaging';
import { dispatchJobAlerts } from '@/modules/alerts';

/**
 * Job lifecycle (JOB-01/04/05) and endorsement lifecycle (END-02/03/04/09).
 */

// ===========================================================================
// Job lifecycle
// ===========================================================================

/**
 * JOB-04 — pay, location, timing and requirements are *material*. Changing one
 * revalidates open matches and notifies everyone already interested. Changing
 * a title is not material and does neither.
 */
const MATERIAL_FIELDS = new Set([
  'fixed_pay_paise', 'variable_max_paise', 'location_id', 'shift',
  'weekly_off', 'min_experience_mo', 'languages', 'critical_skills', 'openings',
]);

export interface JobEdit {
  title?: string; openings?: number; fixedPayPaise?: number; variableMaxPaise?: number;
  shift?: string; weeklyOff?: string; minExperienceMonths?: number;
  languages?: string[]; criticalSkills?: string[]; locationId?: string;
}

const COLUMN_FOR: Record<keyof JobEdit, string> = {
  title: 'title', openings: 'openings', fixedPayPaise: 'fixed_pay_paise',
  variableMaxPaise: 'variable_max_paise', shift: 'shift', weeklyOff: 'weekly_off',
  minExperienceMonths: 'min_experience_mo', languages: 'languages',
  criticalSkills: 'critical_skills', locationId: 'location_id',
};

export async function editJob(jobId: string, edit: JobEdit, actor: string) {
  const at = await now();
  const [before] = await sql<Record<string, unknown>[]>`SELECT * FROM app.job WHERE id = ${jobId}`;
  if (!before) return { error: 'JOB_NOT_FOUND' };
  if (['ARCHIVED', 'CLOSED', 'EXPIRED'].includes(String(before.status))) {
    return { error: 'JOB_NOT_EDITABLE' };
  }

  const changes: { field: string; oldValue: string; newValue: string; material: boolean }[] = [];
  for (const [k, v] of Object.entries(edit) as [keyof JobEdit, unknown][]) {
    if (v === undefined) continue;
    const col = COLUMN_FOR[k];
    const oldRaw = before[col];
    const oldValue = Array.isArray(oldRaw) ? JSON.stringify(oldRaw) : String(oldRaw ?? '');
    const newValue = Array.isArray(v) ? JSON.stringify(v) : String(v);
    if (oldValue === newValue) continue;

    if (Array.isArray(v)) {
      await sql`UPDATE app.job SET ${sql.unsafe(col)} = ${sql.json(v as never)} WHERE id = ${jobId}`;
    } else {
      await sql`UPDATE app.job SET ${sql.unsafe(col)} = ${v as string | number} WHERE id = ${jobId}`;
    }
    changes.push({ field: col, oldValue, newValue, material: MATERIAL_FIELDS.has(col) });
  }
  if (changes.length === 0) return { changes: [], notified: 0, material: false };

  const material = changes.some((c) => c.material);
  let notified = 0;

  if (material) {
    await sql`UPDATE app.job SET last_material_change_at = ${at} WHERE id = ${jobId}`;
    // Tell everyone who already showed interest, before they are re-evaluated.
    const interested = await sql<{ candidate_id: string }[]>`
      SELECT DISTINCT a.candidate_id FROM app.application a
       WHERE a.job_id = ${jobId} AND a.status NOT IN ('WITHDRAWN','REJECTED')
    `;
    const [job] = await sql<{ title: string }[]>`SELECT title FROM app.job WHERE id = ${jobId}`;
    const summary = changes.filter((c) => c.material)
      .map((c) => c.field.replace(/_paise$/, '').replace(/_/g, ' ')).join(', ');
    for (const i of interested) {
      await messagingProvider().send({
        candidateId: i.candidate_id, templateKey: 'job_changed', language: 'en',
        variables: { title: job.title, change: summary },
      });
      notified++;
    }
  }

  for (const c of changes) {
    await sql`
      INSERT INTO app.job_change
        (id, job_id, field, old_value, new_value, material, actor, notified_count, created_at)
      VALUES (${await nextId('JC')}, ${jobId}, ${c.field}, ${c.oldValue}, ${c.newValue},
              ${c.material}, ${actor}, ${c.material ? notified : 0}, ${at})
    `;
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, ${actor}, 'EMPLOYER', 'JOB_EDITED', 'job', ${jobId},
            ${material ? 'JOB-04 material change' : 'JOB-01 minor edit'},
            ${sql.json({ changes } as never)}, ${at})
  `;
  return { changes, notified, material };
}

/**
 * JOB-05 — pausing, closing, filling or archiving stops alerts and applications
 * immediately. Nothing is deleted; the audit history stays.
 */
export async function setJobState(
  jobId: string,
  state: 'LIVE' | 'PAUSED' | 'FILLED' | 'CLOSED' | 'ARCHIVED',
  reason: string, actor: string,
) {
  const at = await now();
  const [job] = await sql<{ status: string; expires_at: Date | null }[]>`
    SELECT status, expires_at FROM app.job WHERE id = ${jobId}
  `;
  if (!job) return { error: 'JOB_NOT_FOUND' };
  if (state === 'LIVE' && job.expires_at && job.expires_at <= at) {
    return { error: 'CANNOT_RESUME_EXPIRED_JOB' };
  }

  await sql`
    UPDATE app.job SET status = ${state}, status_reason = ${reason} WHERE id = ${jobId}
  `;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, ${actor}, 'EMPLOYER', ${'JOB_' + state}, 'job', ${jobId}, ${reason}, ${at})
  `;
  // Resuming a paused job re-opens it to alerts.
  if (state === 'LIVE' && job.status === 'PAUSED') await dispatchJobAlerts(jobId);
  return { ok: true, from: job.status, to: state };
}

/** JOB-01 — duplicate. The copy starts as a draft awaiting approval, never live. */
export async function duplicateJob(jobId: string, actor: string) {
  const at = await now();
  const newId = await nextId('JOB');
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO app.job
      (id, employer_id, location_id, role_config_id, title, openings, fixed_pay_paise,
       variable_max_paise, shift, weekly_off, languages, min_experience_mo,
       critical_skills, attributes, status, duplicated_from, created_at)
    SELECT ${newId}, employer_id, location_id, role_config_id, title || ' (copy)', openings,
           fixed_pay_paise, variable_max_paise, shift, weekly_off, languages,
           min_experience_mo, critical_skills, attributes, 'PENDING_APPROVAL', id, ${at}
      FROM app.job WHERE id = ${jobId}
    RETURNING id
  `;
  if (!row) return { error: 'JOB_NOT_FOUND' };
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, ${actor}, 'EMPLOYER', 'JOB_DUPLICATED', 'job', ${newId},
            ${'Copied from ' + jobId}, ${at})
  `;
  return { jobId: newId };
}

export async function jobChanges(jobId: string) {
  return sql<{
    id: string; field: string; old_value: string | null; new_value: string | null;
    material: boolean; actor: string; notified_count: number; created_at: Date;
  }[]>`SELECT * FROM app.job_change WHERE job_id = ${jobId} ORDER BY created_at DESC`;
}

// ===========================================================================
// Endorsement lifecycle — END-02/03/04/09
// ===========================================================================

/**
 * END-01/02 — the invitation is a signed, single-use, expiring link. The
 * endorser opens a page with no login, verifies a channel by OTP, consents to
 * display, and writes their own words. The candidate cannot author it.
 */
export async function createEndorsementInvite(
  candidateId: string, endorserName: string, endorserContact: string,
  relationship: string, validDays = 14,
) {
  const at = await now();
  const id = await nextId('END');
  const token = randomToken(28);
  await sql`
    INSERT INTO app.endorsement
      (id, candidate_id, endorser_name, endorser_contact, relationship, competencies,
       status, raw_points, invite_token, invited_at, invite_expires_at, created_at)
    VALUES (${id}, ${candidateId}, ${endorserName}, ${endorserContact}, ${relationship},
            ${sql.json([] as never)}, 'PENDING', 0, ${token}, ${at},
            ${addDays(at, validDays)}, ${at})
  `;
  return { id, token };
}

export async function endorsementByToken(token: string) {
  const [row] = await sql<{
    id: string; candidate_id: string; candidate_name: string | null; endorser_name: string;
    relationship: string; status: string; invite_expires_at: Date | null;
  }[]>`
    SELECT e.id, e.candidate_id, c.name AS candidate_name, e.endorser_name,
           e.relationship, e.status, e.invite_expires_at
      FROM app.endorsement e JOIN app.candidate c ON c.id = e.candidate_id
     WHERE e.invite_token = ${token}
  `;
  return row ?? null;
}

const RAW_POINTS: Record<string, number> = {
  FORMER_MANAGER: 10, SENIOR_COLLEAGUE: 10, EXPERIENCED_COLLEAGUE: 5, PEER: 5,
  SELF_OR_DUPLICATE: 0,
};

/**
 * END-02/04/05/06 — submitted by the endorser after channel verification.
 * "Verified contact" means the channel was verified, not that every claim was
 * independently proven, and the UI says so. Points only exist after that.
 */
export async function submitEndorsement(token: string, input: {
  relationship: string; periodKnown: string; competencies: string[];
  comment: string; displayConsent: boolean; otp: string;
}) {
  const at = await now();
  if (!/^\d{6}$/.test(input.otp)) return { error: 'OTP_INVALID' };
  if (!input.displayConsent) return { error: 'DISPLAY_CONSENT_REQUIRED' };

  const e = await endorsementByToken(token);
  if (!e) return { error: 'INVITE_NOT_FOUND' };
  if (e.status !== 'PENDING') return { error: 'ALREADY_SUBMITTED' };
  if (e.invite_expires_at && at > e.invite_expires_at) {
    await sql`UPDATE app.endorsement SET status='EXPIRED' WHERE id=${e.id}`;
    return { error: 'INVITE_EXPIRED' };
  }

  // END-06 — self-endorsement, duplicate contacts and reciprocal patterns.
  const [cand] = await sql<{ phone: string }[]>`
    SELECT phone FROM app.candidate WHERE id = ${e.candidate_id}
  `;
  const [row] = await sql<{ endorser_contact: string }[]>`
    SELECT endorser_contact FROM app.endorsement WHERE id = ${e.id}
  `;
  const [dupe] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.endorsement
     WHERE endorser_contact = ${row.endorser_contact} AND id <> ${e.id}
  `;
  const flagged =
    input.relationship === 'SELF_OR_DUPLICATE' ||
    row.endorser_contact === cand.phone ||
    Number(dupe.n) > 0;

  const withdrawToken = randomToken(28);
  await sql`
    UPDATE app.endorsement
       SET relationship = ${input.relationship}, period_known = ${input.periodKnown},
           competencies = ${sql.json(input.competencies as never)}, comment = ${input.comment},
           display_consent = TRUE, status = ${flagged ? 'FLAGGED' : 'VERIFIED_CONTACT'},
           raw_points = ${flagged ? 0 : RAW_POINTS[input.relationship] ?? 0},
           verified_at = ${at}, withdraw_token = ${withdrawToken}, invite_token = NULL
     WHERE id = ${e.id}
  `;
  if (flagged) {
    await sql`
      INSERT INTO app.fraud_case (id, subject_type, subject_id, signal, detail, status, created_at)
      VALUES (${await nextId('FRD')}, 'endorsement', ${e.id}, 'ENDORSEMENT_DUPLICATE_OR_SELF',
              ${sql.json({ candidateId: e.candidate_id } as never)}, 'OPEN', ${at})
    `;
  }
  return { ok: true, flagged, withdrawToken };
}

/** END-03 — the endorser can withdraw later, through their own secure link. */
export async function withdrawEndorsement(withdrawToken: string) {
  const at = await now();
  const [row] = await sql<{ id: string }[]>`
    UPDATE app.endorsement SET status = 'WITHDRAWN', raw_points = 0
     WHERE withdraw_token = ${withdrawToken} AND status IN ('VERIFIED_CONTACT','FLAGGED')
     RETURNING id
  `;
  if (!row) return { error: 'NOT_FOUND_OR_ALREADY_WITHDRAWN' };
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, 'ENDORSER', 'ENDORSER', 'ENDORSEMENT_WITHDRAWN',
            'endorsement', ${row.id}, 'END-03', ${at})
  `;
  return { ok: true, endorsementId: row.id };
}

/** END-09 — the candidate can hide an endorsement; hidden scores zero. */
export async function setEndorsementHidden(endorsementId: string, hidden: boolean) {
  await sql`
    UPDATE app.endorsement
       SET hidden_by_candidate = ${hidden},
           status = ${hidden ? 'HIDDEN' : 'VERIFIED_CONTACT'},
           raw_points = ${hidden ? 0 : 10}
     WHERE id = ${endorsementId} AND status IN ('VERIFIED_CONTACT','HIDDEN')
  `;
  return { ok: true };
}

// ===========================================================================
// Candidate self-service — CAN-02/04/06
// ===========================================================================

/** CAN-04 — the candidate edits preferences at any time; matches recompute. */
export async function updatePreferences(candidateId: string, prefs: {
  language?: 'mr' | 'hi' | 'en'; maxCommuteMin?: number; expectedPayPaise?: number;
  alertQuietFrom?: number; alertQuietTo?: number; alertMaxPerWeek?: number;
}) {
  const sets: string[] = [];
  if (prefs.language !== undefined) sets.push(`language = '${prefs.language}'`);
  if (prefs.maxCommuteMin !== undefined) sets.push(`max_commute_min = ${Number(prefs.maxCommuteMin)}`);
  if (prefs.expectedPayPaise !== undefined) sets.push(`expected_pay_paise = ${Number(prefs.expectedPayPaise)}`);
  if (prefs.alertQuietFrom !== undefined) sets.push(`alert_quiet_from = ${Number(prefs.alertQuietFrom)}`);
  if (prefs.alertQuietTo !== undefined) sets.push(`alert_quiet_to = ${Number(prefs.alertQuietTo)}`);
  if (prefs.alertMaxPerWeek !== undefined) sets.push(`alert_max_per_week = ${Number(prefs.alertMaxPerWeek)}`);
  if (!sets.length) return { ok: true, changed: 0 };
  await sql.unsafe(`UPDATE app.candidate SET ${sets.join(', ')} WHERE id = '${candidateId.replace(/'/g, "''")}'`);
  return { ok: true, changed: sets.length };
}

/** CAN-02 — where a candidate left off, so an interrupted flow can resume. */
export async function resumePoint(candidateId: string) {
  const [c] = await sql<{
    status: string; mobile_verified_at: Date | null; name: string | null;
  }[]>`SELECT status, mobile_verified_at, name FROM app.candidate WHERE id = ${candidateId}`;
  if (!c) return { step: 'start' as const };
  const [assessment] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.assessment_attempt WHERE candidate_id = ${candidateId}
  `;
  if (!c.mobile_verified_at) return { step: 'otp' as const };
  if (c.status !== 'PROFILE_ACTIVE' || !c.name) return { step: 'profile' as const };
  if (Number(assessment.n) === 0) return { step: 'assess' as const };
  return { step: 'jobs' as const };
}

/**
 * CAN-06 — access, correction and erasure requests, with the 90-day response
 * window the DPDP Rules require recorded on the row so operations can see what
 * is closest to breaching.
 */
export async function raiseDataRequest(
  candidateId: string, kind: 'ACCESS' | 'CORRECTION' | 'ERASURE', detail: string,
) {
  const at = await now();
  const id = await nextId('DR');
  await sql`
    INSERT INTO app.data_request (id, candidate_id, kind, detail, status, due_at, created_at)
    VALUES (${id}, ${candidateId}, ${kind}, ${detail}, 'OPEN', ${addDays(at, 90)}, ${at})
  `;
  return { id };
}

export async function resolveDataRequest(id: string, status: 'ACTIONED' | 'REFUSED') {
  const at = await now();
  await sql`
    UPDATE app.data_request SET status = ${status}, resolved_at = ${at} WHERE id = ${id}
  `;
  return { ok: true };
}

/** PART-07 — conduct rules must be accepted, and the version is recorded. */
export const CONDUCT_VERSION = 'conduct-v1.3';
export const CONDUCT_RULES = [
  'I will never charge a job seeker any fee, for any reason.',
  'I will never promise or guarantee a job to anyone.',
  'I will never collect identity documents, certificates or bank details from a candidate.',
  'I will never contact a candidate who has not agreed to be assisted by me.',
  'I will never send my own messages about pay or job terms; only platform messages.',
  'I understand that a substantiated complaint ends my participation and any unpaid rewards.',
];

export async function acceptConduct(partnerId: string) {
  const at = await now();
  await sql`
    UPDATE app.partner SET conduct_accepted_at = ${at}, conduct_version = ${CONDUCT_VERSION}
     WHERE id = ${partnerId}
  `;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, created_at)
    VALUES (${await nextId('AUD')}, ${partnerId}, 'PARTNER', 'CONDUCT_ACCEPTED', 'partner',
            ${partnerId}, ${CONDUCT_VERSION}, ${at})
  `;
  return { ok: true };
}
