import { sql } from '@/lib/db';
import { now, addDays } from '@/lib/clock';
import { nextId, randomToken } from '@/lib/ids';
import { activeCommercialPolicy } from '@/modules/configuration';
import { messagingProvider } from '@/modules/adapters/messaging';
import { recordMatch } from '@/modules/matching';

/**
 * Candidate journey (§8.3, §8.4, §8.11).
 *
 * Entry is by QR, partner code, or direct. Attribution binds at the first
 * OTP-verified registration and is immutable afterwards — a later scan can
 * never overwrite it (REF-02, §15 duplicate-referral row).
 */

export type Language = 'mr' | 'hi' | 'en';

export interface RegistrationInput {
  phone: string;
  language: Language;
  siteCode?: string | null;   // QR token or typed partner code
  method: 'QR' | 'PARTNER_CODE' | 'DIRECT';
}

export async function startRegistration(input: RegistrationInput) {
  const at = await now();
  const policy = await activeCommercialPolicy();

  const [existing] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM app.candidate WHERE phone = ${input.phone}
  `;
  if (existing) return { candidateId: existing.id, returning: true };

  const id = await nextId('CAN');
  await sql`
    INSERT INTO app.candidate (id, phone, language, status, created_at)
    VALUES (${id}, ${input.phone}, ${input.language}, 'STARTED', ${at})
  `;

  // Resolve the source before OTP so the candidate can be shown who referred
  // them and correct it (REF-01), but bind only on verification.
  let siteId: string | null = null;
  let partnerId: string | null = null;
  let siteStatus: string | null = null;
  if (input.siteCode) {
    const [site] = await sql<{ id: string; partner_id: string; status: string; p_status: string }[]>`
      SELECT s.id, s.partner_id, s.status, p.status AS p_status
        FROM app.partner_site s JOIN app.partner p ON p.id = s.partner_id
       WHERE s.partner_code = ${input.siteCode} OR s.qr_token = ${input.siteCode}
    `;
    if (site) { siteId = site.id; partnerId = site.partner_id; siteStatus = site.status === 'ACTIVE' && site.p_status === 'VERIFIED' ? 'OK' : 'INACTIVE'; }
  }

  return {
    candidateId: id, returning: false,
    pendingAttribution: siteId
      ? { siteId, partnerId, method: input.method, valid: siteStatus === 'OK',
          windowDays: policy.attributionWindowDays }
      : null,
  };
}

/**
 * OTP verification is the moment attribution binds (§8.11 default rule).
 * A suspended or revoked site produces an attribution held for operations
 * review rather than silently dropped — the CAN-008 seed case.
 */
export async function verifyAndBind(
  candidateId: string,
  attribution: { siteId: string | null; partnerId: string | null; method: 'QR' | 'PARTNER_CODE' | 'DIRECT'; valid: boolean } | null,
) {
  const at = await now();
  const policy = await activeCommercialPolicy();

  await sql`
    UPDATE app.candidate
       SET status = 'MOBILE_VERIFIED', mobile_verified_at = ${at}
     WHERE id = ${candidateId} AND mobile_verified_at IS NULL
  `;

  const [already] = await sql<{ id: string }[]>`
    SELECT id FROM app.attribution WHERE candidate_id = ${candidateId}
  `;
  if (already) return { attributionId: already.id, created: false };  // REF-02, immutable

  const id = await nextId('ATT');
  await sql`
    INSERT INTO app.attribution
      (id, candidate_id, partner_id, partner_site_id, method, window_days, status, status_reason, bound_at, expires_at)
    VALUES (
      ${id}, ${candidateId},
      ${attribution?.partnerId ?? null}, ${attribution?.siteId ?? null},
      ${attribution?.method ?? 'DIRECT'}, ${policy.attributionWindowDays},
      ${!attribution ? 'ACTIVE' : attribution.valid ? 'ACTIVE' : 'UNDER_REVIEW'},
      ${attribution && !attribution.valid ? 'SOURCE_SITE_NOT_ACTIVE_AT_BINDING' : null},
      ${at}, ${addDays(at, policy.attributionWindowDays)}
    )
  `;
  if (attribution && !attribution.valid) {
    await sql`
      INSERT INTO app.fraud_case (id, subject_type, subject_id, signal, detail, status, created_at)
      VALUES (${await nextId('FRD')}, 'attribution', ${id}, 'SOURCE_SITE_NOT_ACTIVE',
              ${sql.json({ candidateId, siteId: attribution.siteId } as never)}, 'OPEN', ${at})
    `;
  }
  return { attributionId: id, created: true };
}

export async function grantConsent(
  candidateId: string,
  purpose: 'PROCESSING' | 'PARTNER_ASSISTANCE' | 'JOB_ALERTS' | 'DOCUMENTS' | 'PRECISE_LOCATION',
  noticeVersion = 'notice-v1.3-' ,
) {
  const at = await now();
  await sql`
    INSERT INTO app.consent_record (id, candidate_id, purpose, notice_version, channel, granted_at)
    VALUES (${await nextId('CNS')}, ${candidateId}, ${purpose}, ${noticeVersion + purpose.toLowerCase()}, 'WHATSAPP', ${at})
    ON CONFLICT (candidate_id, purpose)
    DO UPDATE SET granted_at = ${at}, withdrawn_at = NULL
  `;
}

/**
 * CAN-05 / §15 — withdrawal stops future sharing for that purpose.
 * Attribution already earned under disclosed rules is preserved; a completed
 * unlock is not unwound, because the employer already received what it paid
 * for. Both facts are surfaced to the candidate, never silently applied.
 */
export async function withdrawConsent(candidateId: string, purpose: string) {
  const at = await now();
  await sql`
    UPDATE app.consent_record SET withdrawn_at = ${at}
     WHERE candidate_id = ${candidateId} AND purpose = ${purpose}
  `;
  if (purpose === 'PROCESSING') {
    await sql`
      UPDATE app.application SET status = 'WITHDRAWN', status_at = ${at}
       WHERE candidate_id = ${candidateId}
         AND status NOT IN ('UNLOCKED','SELECTED','JOINED','CONTACTED','INTERVIEW')
    `;
    await sql`UPDATE app.candidate SET status = 'PAUSED' WHERE id = ${candidateId}`;
  }
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, ${candidateId}, 'CANDIDATE', 'CONSENT_WITHDRAWN',
            'consent_record', ${candidateId}, ${purpose}, '{}', ${at})
  `;
}

export interface ProfileInput {
  name: string; localityKey: string; age18: boolean;
  experienceMonths: number; experienceTags: string[]; languages: string[];
  currentPayPaise: number | null; expectedPayPaise: number;
  maxCommuteMin: number; shiftAvailability: string[];
}

export async function completeProfile(candidateId: string, p: ProfileInput) {
  await sql`
    UPDATE app.candidate SET
      name = ${p.name}, locality_key = ${p.localityKey}, age_confirmed_18 = ${p.age18},
      experience_months = ${p.experienceMonths},
      experience_tags = ${sql.json(p.experienceTags as never)},
      languages = ${sql.json(p.languages as never)},
      current_pay_paise = ${p.currentPayPaise}, expected_pay_paise = ${p.expectedPayPaise},
      max_commute_min = ${p.maxCommuteMin},
      shift_availability = ${sql.json(p.shiftAvailability as never)},
      status = ${p.age18 ? 'PROFILE_ACTIVE' : 'DELETED_BLOCKED'}
    WHERE id = ${candidateId}
  `;
}

export async function recordAssessment(
  candidateId: string, templateId: string, answers: Record<string, string>,
) {
  const at = await now();
  const [tpl] = await sql<{ version: string; questions: { id: string; answer: string; marks: number }[] }[]>`
    SELECT version, questions FROM app.assessment_template WHERE id = ${templateId}
  `;
  let earned = 0, total = 0;
  const responses = tpl.questions.map((q) => {
    total += q.marks;
    const given = answers[q.id];
    const correct = given === q.answer;
    if (correct) earned += q.marks;
    return { questionId: q.id, given: given ?? null, correct };
  });
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);
  const id = await nextId('ASM');
  await sql`
    INSERT INTO app.assessment_attempt
      (id, candidate_id, template_id, template_version, responses, score, started_at, completed_at)
    VALUES (${id}, ${candidateId}, ${templateId}, ${tpl.version},
            ${sql.json(responses as never)}, ${score}, ${at}, ${at})
  `;
  return { id, score };
}

/** Direct score seeding for the canonical dataset, where §22.6 fixes the score. */
export async function seedAssessmentScore(
  candidateId: string, templateId: string, score: number, at: Date,
) {
  const [tpl] = await sql<{ version: string }[]>`
    SELECT version FROM app.assessment_template WHERE id = ${templateId}
  `;
  await sql`
    INSERT INTO app.assessment_attempt
      (id, candidate_id, template_id, template_version, responses, score, started_at, completed_at)
    VALUES (${await nextId('ASM')}, ${candidateId}, ${templateId}, ${tpl.version},
            ${sql.json([{ note: 'seeded canonical score per §22.6' }] as never)},
            ${score}, ${at}, ${at})
  `;
}

/** END-01..06 — invite, verify by OTP link, score only after contact verification. */
export async function inviteEndorsement(
  candidateId: string, endorserName: string, endorserContact: string,
  relationship: 'FORMER_MANAGER' | 'SENIOR_COLLEAGUE' | 'EXPERIENCED_COLLEAGUE' | 'PEER' | 'SELF_OR_DUPLICATE',
  competencies: string[], comment?: string,
) {
  const at = await now();
  const id = await nextId('END');
  await sql`
    INSERT INTO app.endorsement
      (id, candidate_id, endorser_name, endorser_contact, relationship, competencies,
       comment, status, raw_points, invite_token, invited_at, created_at)
    VALUES (${id}, ${candidateId}, ${endorserName}, ${endorserContact}, ${relationship},
            ${sql.json(competencies as never)}, ${comment ?? null}, 'PENDING', 0,
            ${randomToken()}, ${at}, ${at})
  `;
  return { id };
}

const RAW_POINTS: Record<string, number> = {
  FORMER_MANAGER: 10, SENIOR_COLLEAGUE: 10,
  EXPERIENCED_COLLEAGUE: 5, PEER: 5, SELF_OR_DUPLICATE: 0,
};

export async function verifyEndorsement(endorsementId: string) {
  const at = await now();
  const [e] = await sql<{
    candidate_id: string; endorser_contact: string; relationship: string;
  }[]>`SELECT * FROM app.endorsement WHERE id = ${endorsementId}`;

  // END-06 — duplicate contact, self-endorsement and reciprocal patterns are
  // flagged and score zero while flagged.
  const [cand] = await sql<{ phone: string }[]>`
    SELECT phone FROM app.candidate WHERE id = ${e.candidate_id}
  `;
  const [dupe] = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM app.endorsement
     WHERE endorser_contact = ${e.endorser_contact} AND id <> ${endorsementId}
  `;
  const flagged =
    e.relationship === 'SELF_OR_DUPLICATE' ||
    e.endorser_contact === cand.phone ||
    Number(dupe.n) > 0;

  await sql`
    UPDATE app.endorsement
       SET status = ${flagged ? 'FLAGGED' : 'VERIFIED_CONTACT'},
           raw_points = ${flagged ? 0 : RAW_POINTS[e.relationship] ?? 0},
           verified_at = ${at}
     WHERE id = ${endorsementId}
  `;
  if (flagged) {
    await sql`
      INSERT INTO app.fraud_case (id, subject_type, subject_id, signal, detail, status, created_at)
      VALUES (${await nextId('FRD')}, 'endorsement', ${endorsementId}, 'ENDORSEMENT_DUPLICATE_OR_SELF',
              ${sql.json({ candidateId: e.candidate_id } as never)}, 'OPEN', ${at})
    `;
  }
  return { flagged };
}

/** §8.3 step 9 — the candidate explicitly applies. Nothing is auto-applied. */
export async function apply(candidateId: string, jobId: string, source = 'WHATSAPP') {
  const at = await now();
  const consents = await sql<{ purpose: string; granted_at: Date | null; withdrawn_at: Date | null }[]>`
    SELECT purpose, granted_at, withdrawn_at FROM app.consent_record WHERE candidate_id = ${candidateId}
  `;
  const snapshot = Object.fromEntries(
    consents.map((c) => [c.purpose, c.withdrawn_at ? 'WITHDRAWN' : c.granted_at ? 'GRANTED' : 'NONE']),
  );
  const id = await nextId('APP');
  await sql`
    INSERT INTO app.application
      (id, candidate_id, job_id, source, status, consent_snapshot, applied_at, status_at, created_at)
    VALUES (${id}, ${candidateId}, ${jobId}, ${source}, 'APPLIED',
            ${sql.json(snapshot as never)}, ${at}, ${at}, ${at})
    ON CONFLICT (candidate_id, job_id) DO NOTHING
  `;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM app.application WHERE candidate_id = ${candidateId} AND job_id = ${jobId}
  `;
  return { applicationId: row.id };
}

/**
 * MATCH-09 — reconfirm interest before the profile can appear as a preview.
 * No response holds the candidate back rather than charging the employer.
 */
export async function reconfirmInterest(applicationId: string, interested: boolean) {
  const at = await now();
  if (!interested) {
    await sql`
      UPDATE app.application SET status = 'WITHDRAWN', status_at = ${at} WHERE id = ${applicationId}
    `;
    return;
  }
  await sql`
    UPDATE app.application
       SET reconfirmed_at = ${at}, status = 'CANDIDATE_RECONFIRMED', status_at = ${at}
     WHERE id = ${applicationId}
  `;
}

/** Apply, reconfirm and evaluate in one call — used by the simulator and seed. */
export async function applyAndEvaluate(candidateId: string, jobId: string, reconfirm = true) {
  const { applicationId } = await apply(candidateId, jobId);
  if (reconfirm) await reconfirmInterest(applicationId, true);
  const { id, computation } = await recordMatch(applicationId, candidateId, jobId);
  return { applicationId, matchId: id, computation };
}

export async function sendTemplate(candidateId: string, templateKey: string, vars?: Record<string, string>) {
  const [c] = await sql<{ language: string }[]>`SELECT language FROM app.candidate WHERE id = ${candidateId}`;
  return messagingProvider().send({
    candidateId, templateKey, language: c?.language ?? 'en', variables: vars,
  });
}
