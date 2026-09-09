import { sql } from '@/lib/db';
import { now, addHours } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { getRoleConfig } from '@/modules/configuration';
import { messagingProvider } from '@/modules/adapters/messaging';

/**
 * Interviews (§8.9) and selection/onboarding (§8.10).
 *
 * §8.9 is the section the PRD numbering skips — 8.8 runs straight into 8.10 —
 * even though the Interview entity is in §12, "Interview scheduled" is in the
 * §11 status model, and §16.3 asks for a candidate no-show rate that cannot be
 * measured without it. Implemented here as INT-01..08.
 *
 * The rule that governs both sections: none of it can affect billing. An
 * unlock is charged and a partner reward accrues whether or not any of this
 * ever happens (LEAD-10, ONB-06, §6.7).
 */

// ===========================================================================
// Interviews — §8.9
// ===========================================================================

/** INT-01 — the employer proposes a slot; nothing is booked without the candidate. */
export async function proposeInterview(
  applicationId: string, scheduledAt: Date, format: string,
  locationNote: string, safetyNote: string,
) {
  const at = await now();
  const [app] = await sql<{ candidate_id: string; job_id: string; status: string }[]>`
    SELECT candidate_id, job_id, status FROM app.application WHERE id = ${applicationId}
  `;
  if (!app) return { error: 'APPLICATION_NOT_FOUND' };
  // An employer must have paid to see the contact details before scheduling.
  const [unlock] = await sql<{ id: string }[]>`
    SELECT id FROM app.qualified_lead_unlock
     WHERE job_id = ${app.job_id} AND candidate_id = ${app.candidate_id} AND status = 'CONFIRMED'
  `;
  if (!unlock) return { error: 'PROFILE_NOT_UNLOCKED' };

  const id = await nextId('ITV');
  await sql`
    INSERT INTO app.interview
      (id, application_id, scheduled_at, format, location_note, safety_note, status, created_at)
    VALUES (${id}, ${applicationId}, ${scheduledAt}, ${format}, ${locationNote},
            ${safetyNote}, 'PROPOSED', ${at})
  `;
  const [job] = await sql<{ title: string; brand: string }[]>`
    SELECT j.title, e.brand_name AS brand FROM app.job j
      JOIN app.employer_organisation e ON e.id = j.employer_id WHERE j.id = ${app.job_id}
  `;
  await messagingProvider().send({
    candidateId: app.candidate_id, templateKey: 'interview_invite', language: 'en',
    variables: {
      employer: job.brand, title: job.title,
      when: scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      where: locationNote,
    },
  });
  await sql`
    UPDATE app.application SET status = 'INTERVIEW', status_at = ${at} WHERE id = ${applicationId}
  `;
  await sql`
    INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
    VALUES (${await nextId('OUT')}, ${applicationId}, 'INTERVIEW_SCHEDULED', 'EU-001', 'EMPLOYER_PORTAL', ${at})
  `;
  return { interviewId: id };
}

/** INT-02 — the candidate confirms or declines from WhatsApp. */
export async function respondToInterview(interviewId: string, confirmed: boolean) {
  const at = await now();
  await sql`
    UPDATE app.interview
       SET candidate_confirmed = ${confirmed}, status = ${confirmed ? 'CONFIRMED' : 'DECLINED'}
     WHERE id = ${interviewId}
  `;
  return { ok: true, at };
}

/** INT-03 — reschedule keeps the original time rather than overwriting it. */
export async function rescheduleInterview(interviewId: string, newTime: Date) {
  const at = await now();
  const [i] = await sql<{ scheduled_at: Date; application_id: string }[]>`
    SELECT scheduled_at, application_id FROM app.interview WHERE id = ${interviewId}
  `;
  if (!i) return { error: 'NOT_FOUND' };
  await sql`
    UPDATE app.interview
       SET rescheduled_from = ${i.scheduled_at}, scheduled_at = ${newTime},
           status = 'RESCHEDULED', candidate_confirmed = FALSE, reminder_sent_at = NULL
     WHERE id = ${interviewId}
  `;
  const [app] = await sql<{ candidate_id: string }[]>`
    SELECT candidate_id FROM app.application WHERE id = ${i.application_id}
  `;
  await messagingProvider().send({
    candidateId: app.candidate_id, templateKey: 'interview_reminder', language: 'en',
    variables: {
      when: newTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
    },
  });
  return { ok: true, at };
}

/**
 * INT-04 — reminders. Sent once, only for a confirmed interview, and only
 * inside the 24 hours before it. Advancing the demo clock is what triggers them.
 */
export async function sendDueInterviewReminders(): Promise<number> {
  const at = await now();
  const due = await sql<{ id: string; candidate_id: string; scheduled_at: Date }[]>`
    SELECT i.id, a.candidate_id, i.scheduled_at
      FROM app.interview i JOIN app.application a ON a.id = i.application_id
     WHERE i.status = 'CONFIRMED'
       AND i.reminder_sent_at IS NULL
       AND i.scheduled_at BETWEEN ${at} AND ${addHours(at, 24)}
  `;
  for (const d of due) {
    await messagingProvider().send({
      candidateId: d.candidate_id, templateKey: 'interview_reminder', language: 'en',
      variables: {
        when: d.scheduled_at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      },
    });
    await sql`UPDATE app.interview SET reminder_sent_at = ${at} WHERE id = ${d.id}`;
  }
  return due.length;
}

/** INT-05/06 — attendance, including a no-show by either side (§16.3). */
export async function recordInterviewOutcome(
  interviewId: string,
  outcome: 'ATTENDED' | 'NO_SHOW_CANDIDATE' | 'NO_SHOW_EMPLOYER' | 'CANCELLED',
  note?: string,
) {
  const at = await now();
  await sql`
    UPDATE app.interview
       SET status = ${outcome}, attended = ${outcome === 'ATTENDED'},
           outcome = ${note ?? null},
           no_show_by = ${outcome === 'NO_SHOW_CANDIDATE' ? 'CANDIDATE'
                        : outcome === 'NO_SHOW_EMPLOYER' ? 'EMPLOYER' : null}
     WHERE id = ${interviewId}
  `;
  if (outcome === 'ATTENDED') {
    const [i] = await sql<{ application_id: string }[]>`
      SELECT application_id FROM app.interview WHERE id = ${interviewId}
    `;
    await sql`
      INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
      VALUES (${await nextId('OUT')}, ${i.application_id}, 'INTERVIEW_ATTENDED', 'EU-001', 'EMPLOYER_PORTAL', ${at})
    `;
  }
  return { ok: true };
}

// ===========================================================================
// Selection and onboarding — §8.10
// ===========================================================================

export interface OfferInput {
  applicationId: string; roleTitle: string; locationId: string;
  fixedPaise: number; variablePaise: number;
  joiningDate: string; offerValidHours: number;
}

/**
 * ONB-01 — the employer marks a candidate selected and enters the offer terms.
 * Fixed and variable stay separate here too, for the same reason as §6.6.
 * ONB-03 — the document checklist comes from the role configuration, so a
 * different industry asks for different papers with no code change.
 */
export async function makeOffer(input: OfferInput) {
  const at = await now();
  const [app] = await sql<{ candidate_id: string; job_id: string }[]>`
    SELECT candidate_id, job_id FROM app.application WHERE id = ${input.applicationId}
  `;
  if (!app) return { error: 'APPLICATION_NOT_FOUND' };

  const [unlock] = await sql<{ id: string }[]>`
    SELECT id FROM app.qualified_lead_unlock
     WHERE job_id = ${app.job_id} AND candidate_id = ${app.candidate_id} AND status = 'CONFIRMED'
  `;
  if (!unlock) return { error: 'PROFILE_NOT_UNLOCKED' };

  const [job] = await sql<{ role_config_id: string; brand: string }[]>`
    SELECT j.role_config_id, e.brand_name AS brand FROM app.job j
      JOIN app.employer_organisation e ON e.id = j.employer_id WHERE j.id = ${app.job_id}
  `;
  const cfg = await getRoleConfig(job.role_config_id);

  const caseId = await nextId('ONB');
  await sql`
    INSERT INTO app.onboarding_case
      (id, application_id, role_title, location_id, offer_fixed_paise, offer_variable_paise,
       joining_date, offer_expires_at, checklist, status, created_at)
    VALUES (${caseId}, ${input.applicationId}, ${input.roleTitle}, ${input.locationId},
            ${input.fixedPaise}, ${input.variablePaise}, ${input.joiningDate},
            ${addHours(at, input.offerValidHours)},
            ${sql.json(cfg.documentChecklist as never)}, 'OFFER_SENT', ${at})
  `;
  await sql`
    UPDATE app.application SET status = 'SELECTED', status_at = ${at} WHERE id = ${input.applicationId}
  `;
  await sql`
    INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
    VALUES (${await nextId('OUT')}, ${input.applicationId}, 'SELECTED', 'EU-001', 'EMPLOYER_PORTAL', ${at})
  `;
  // ONB-02 — the candidate gets a plain summary and can accept, decline or ask for help.
  await messagingProvider().send({
    candidateId: app.candidate_id, templateKey: 'offer_summary', language: 'en',
    variables: {
      employer: job.brand, title: input.roleTitle,
      fixed: String(input.fixedPaise / 100), joining: input.joiningDate,
    },
  });
  return { caseId };
}

/** ONB-02/03 — acceptance opens the document checklist; decline closes the case. */
export async function respondToOffer(caseId: string, accepted: boolean) {
  const at = await now();
  const [c] = await sql<{
    application_id: string; checklist: string[]; status: string; offer_expires_at: Date;
  }[]>`SELECT * FROM app.onboarding_case WHERE id = ${caseId}`;
  if (!c) return { error: 'CASE_NOT_FOUND' };
  if (c.status !== 'OFFER_SENT') return { error: 'OFFER_NOT_OPEN' };
  if (at > c.offer_expires_at) {
    await sql`UPDATE app.onboarding_case SET status='OFFER_EXPIRED', decided_at=${at} WHERE id=${caseId}`;
    return { error: 'OFFER_EXPIRED' };
  }

  if (!accepted) {
    await sql`UPDATE app.onboarding_case SET status='OFFER_DECLINED', decided_at=${at} WHERE id=${caseId}`;
    return { ok: true, status: 'OFFER_DECLINED' };
  }

  const [app] = await sql<{ candidate_id: string }[]>`
    SELECT candidate_id FROM app.application WHERE id = ${c.application_id}
  `;
  await sql`
    UPDATE app.onboarding_case SET status='DOCUMENTS_PENDING', decided_at=${at} WHERE id=${caseId}
  `;
  // One row per required document, so the checklist has real state.
  for (const key of c.checklist) {
    const [def] = await sql<{ retention_days: number; access_policy: string }[]>`
      SELECT retention_days, access_policy FROM app.document_definition WHERE key = ${key}
    `;
    await sql`
      INSERT INTO app.candidate_document
        (id, onboarding_case_id, candidate_id, document_key, access_policy, retention_days, status, created_at)
      VALUES (${await nextId('DOC')}, ${caseId}, ${app.candidate_id}, ${key},
              ${def?.access_policy ?? 'EMPLOYER_CASE_SCOPED'}, ${def?.retention_days ?? 365},
              'PENDING', ${at})
      ON CONFLICT (onboarding_case_id, document_key) DO NOTHING
    `;
  }
  await sql`
    UPDATE app.consent_record SET granted_at = ${at}, withdrawn_at = NULL
     WHERE candidate_id = ${app.candidate_id} AND purpose = 'DOCUMENTS'
  `;
  await sql`
    INSERT INTO app.consent_record (id, candidate_id, purpose, notice_version, channel, granted_at)
    VALUES (${await nextId('CNS')}, ${app.candidate_id}, 'DOCUMENTS', 'notice-v1.3-documents', 'MOBILE_WEB', ${at})
    ON CONFLICT (candidate_id, purpose) DO UPDATE SET granted_at = ${at}, withdrawn_at = NULL
  `;
  return { ok: true, status: 'DOCUMENTS_PENDING' };
}

/**
 * ONB-04 — the candidate uploads to secure storage. The prototype stores a
 * reference to a watermarked placeholder; no real document ever exists.
 */
export async function uploadDocument(documentId: string) {
  const at = await now();
  await sql`
    UPDATE app.candidate_document
       SET status='UPLOADED', uploaded_at=${at},
           object_ref=${'demo://watermarked/' + documentId + '.png'}
     WHERE id = ${documentId} AND status IN ('PENDING','REJECTED')
  `;
  return { ok: true };
}

/** ONB-07 — a rejection must carry a reason and allow safe resubmission. */
export async function reviewDocument(
  documentId: string, decision: 'APPROVED' | 'REJECTED', reason?: string,
) {
  const at = await now();
  if (decision === 'REJECTED' && !reason?.trim()) return { error: 'REASON_REQUIRED' };
  const rejectReason: string | null = decision === 'REJECTED' ? (reason ?? null) : null;
  await sql`
    UPDATE app.candidate_document
       SET status=${decision}, reject_reason=${rejectReason}, reviewed_at=${at}
     WHERE id = ${documentId}
  `;
  const [d] = await sql<{ onboarding_case_id: string }[]>`
    SELECT onboarding_case_id FROM app.candidate_document WHERE id = ${documentId}
  `;
  const [remaining] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text n FROM app.candidate_document
     WHERE onboarding_case_id = ${d.onboarding_case_id} AND status <> 'APPROVED'
  `;
  if (Number(remaining.n) === 0) {
    await sql`
      UPDATE app.onboarding_case SET status='DOCUMENTS_COMPLETE' WHERE id=${d.onboarding_case_id}
    `;
  }
  return { ok: true };
}

/** ONB-06 — joining is recorded when the employer chooses to; it changes no money. */
export async function markJoined(caseId: string) {
  const at = await now();
  const [c] = await sql<{ application_id: string }[]>`
    SELECT application_id FROM app.onboarding_case WHERE id = ${caseId}
  `;
  if (!c) return { error: 'CASE_NOT_FOUND' };
  await sql`UPDATE app.onboarding_case SET status='JOINED' WHERE id=${caseId}`;
  await sql`
    UPDATE app.application SET status='JOINED', status_at=${at} WHERE id=${c.application_id}
  `;
  await sql`
    INSERT INTO app.optional_outcome_event (id, application_id, outcome, actor, source, created_at)
    VALUES (${await nextId('OUT')}, ${c.application_id}, 'JOINED', 'EU-001', 'EMPLOYER_PORTAL', ${at})
  `;
  return { ok: true };
}

export async function onboardingCasesForEmployer(employerId: string) {
  return sql<{
    id: string; status: string; role_title: string; candidate_id: string; name: string;
    application_id: string; offer_fixed_paise: string; offer_variable_paise: string;
    joining_date: string | null; offer_expires_at: Date; docs_total: string; docs_approved: string;
  }[]>`
    SELECT o.id, o.status, o.role_title, a.candidate_id, c.name, o.application_id,
           o.offer_fixed_paise, o.offer_variable_paise, o.joining_date::text AS joining_date,
           o.offer_expires_at,
           (SELECT COUNT(*)::text FROM app.candidate_document d WHERE d.onboarding_case_id=o.id) AS docs_total,
           (SELECT COUNT(*)::text FROM app.candidate_document d
             WHERE d.onboarding_case_id=o.id AND d.status='APPROVED') AS docs_approved
      FROM app.onboarding_case o
      JOIN app.application a ON a.id = o.application_id
      JOIN app.candidate c ON c.id = a.candidate_id
      JOIN app.job j ON j.id = a.job_id
     WHERE j.employer_id = ${employerId}
     ORDER BY o.created_at DESC
  `;
}

export async function documentsForCase(caseId: string) {
  return sql<{
    id: string; document_key: string; status: string; reject_reason: string | null;
    uploaded_at: Date | null; reviewed_at: Date | null;
  }[]>`
    SELECT id, document_key, status, reject_reason, uploaded_at, reviewed_at
      FROM app.candidate_document WHERE onboarding_case_id = ${caseId} ORDER BY document_key
  `;
}

export async function interviewsForEmployer(employerId: string) {
  return sql<{
    id: string; application_id: string; candidate_id: string; name: string; job_id: string;
    scheduled_at: Date | null; status: string; candidate_confirmed: boolean;
    format: string | null; location_note: string | null; safety_note: string | null;
    rescheduled_from: Date | null; reminder_sent_at: Date | null;
  }[]>`
    SELECT i.id, i.application_id, a.candidate_id, c.name, a.job_id, i.scheduled_at,
           i.status, i.candidate_confirmed, i.format, i.location_note, i.safety_note,
           i.rescheduled_from, i.reminder_sent_at
      FROM app.interview i
      JOIN app.application a ON a.id = i.application_id
      JOIN app.candidate c ON c.id = a.candidate_id
      JOIN app.job j ON j.id = a.job_id
     WHERE j.employer_id = ${employerId}
     ORDER BY i.scheduled_at DESC NULLS LAST
  `;
}
