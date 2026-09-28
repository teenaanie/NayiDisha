import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId, randomToken } from '@/lib/ids';
import { verifyAndBind, grantConsent } from '@/modules/candidate';
import { sendInviteTemplate, receiveOnInvite, messagingProvider } from '@/modules/adapters/messaging';
import { validateSubmission, QUALIFICATIONS, type FlowLang } from './flow';

/**
 * WhatsApp self-registration (migration 014).
 *
 *   ops invite ─▶ "explore jobs?" ─▶ Yes ─▶ form (Flow) ─▶ registered ─▶ sign-in link
 *
 * Every step is provider-agnostic: the simulator and a production WhatsApp
 * webhook both arrive here as the same normalised events, through the signed
 * /api/whatsapp/webhook route. Replying from the invited number proves
 * possession of it, which is why a submission marks the mobile as verified.
 */

export const DEMO_PHONE = /^\+910000[0-9]{6}$/;

export interface InviteResult { phone: string; status: 'SENT' | 'ALREADY_REGISTERED' | 'INVALID'; token?: string }

export async function sendInvites(sentBy: string, phones: string[], language: FlowLang): Promise<InviteResult[]> {
  const results: InviteResult[] = [];
  for (const raw of Array.from(new Set(phones.map((p) => p.replace(/[\s-]/g, '')).filter(Boolean))).slice(0, 50)) {
    const phone = raw.startsWith('+') ? raw : `+91${raw}`;
    // Demo numbers only: the simulator must never be pointed at a real person.
    if (!DEMO_PHONE.test(phone)) { results.push({ phone: raw, status: 'INVALID' }); continue; }
    const [existing] = await sql`SELECT id FROM app.candidate WHERE phone=${phone} AND mobile_verified_at IS NOT NULL`;
    if (existing) { results.push({ phone, status: 'ALREADY_REGISTERED' }); continue; }
    const id = await nextId('WAI');
    const token = randomToken(24);
    await sql`INSERT INTO app.whatsapp_invite (id, phone, token, sent_by, status, language, sent_at)
              VALUES (${id}, ${phone}, ${token}, ${sentBy}, 'SENT', ${language}, ${await now()})`;
    await sendInviteTemplate(id, 'job_invite', language);
    results.push({ phone, status: 'SENT', token });
  }
  return results;
}

export async function inviteByToken(token: string) {
  const [invite] = await sql`SELECT * FROM app.whatsapp_invite WHERE token=${token}`;
  return invite ?? null;
}

export async function inviteThread(inviteId: string) {
  return sql<{ direction: string; body: string; template_key: string | null; created_at: Date }[]>`
    SELECT direction, body, template_key, created_at FROM app.message_log WHERE invite_id=${inviteId} ORDER BY created_at, id`;
}

async function findInvite(ref: { token?: string; phone?: string }) {
  if (ref.token) return inviteByToken(ref.token);
  if (ref.phone) {
    const [invite] = await sql`SELECT * FROM app.whatsapp_invite WHERE phone=${ref.phone} AND status IN ('SENT','ACCEPTED') ORDER BY sent_at DESC LIMIT 1`;
    return invite ?? null;
  }
  return null;
}

export async function handleInviteReply(ref: { token?: string; phone?: string }, accepted: boolean, replyText: string) {
  const invite = await findInvite(ref);
  if (!invite) throw new Error('UNKNOWN_INVITE');
  if (!['SENT', 'ACCEPTED', 'DECLINED'].includes(invite.status)) return { status: invite.status, duplicate: true };
  await receiveOnInvite(invite.id, replyText.slice(0, 200));
  await sql`UPDATE app.whatsapp_invite SET status=${accepted ? 'ACCEPTED' : 'DECLINED'}, responded_at=${await now()} WHERE id=${invite.id}`;
  await sendInviteTemplate(invite.id, accepted ? 'registration_form' : 'invite_declined', invite.language);
  return { status: accepted ? 'ACCEPTED' : 'DECLINED' };
}

export interface StoredResume { objectKey: string; storage: string; filename: string; mime: string; sizeBytes: number }

export async function handleFlowSubmission(ref: { token?: string; phone?: string }, payload: Record<string, unknown>, resume: StoredResume, signInUrl: string) {
  const invite = await findInvite(ref);
  if (!invite) throw new Error('UNKNOWN_INVITE');
  if (invite.status === 'FORM_SUBMITTED') return { candidateId: invite.candidate_id as string, duplicate: true };
  if (invite.status !== 'ACCEPTED') throw new Error('INVITE_NOT_ACCEPTED');

  const at = await now();
  const r = validateSubmission(payload, at);
  const phone: string = invite.phone;

  // Upsert by phone. Someone who already began the conversational journey keeps
  // their record and status; the form only fills in what it collects.
  const [existing] = await sql`SELECT id, status FROM app.candidate WHERE phone=${phone}`;
  if (existing?.status === 'DELETED_BLOCKED') throw new Error('PROFILE_BLOCKED');
  let candidateId: string = existing?.id;
  if (!existing) {
    candidateId = await nextId('CAN');
    await sql`INSERT INTO app.candidate (id, phone, language, status, created_at) VALUES (${candidateId}, ${phone}, ${invite.language}, 'STARTED', ${at})`;
  }
  await verifyAndBind(candidateId, null);
  await grantConsent(candidateId, 'PROCESSING');
  if (r.consentAlerts) await grantConsent(candidateId, 'JOB_ALERTS');
  // The resume is a document the candidate chose to share for matching.
  await grantConsent(candidateId, 'DOCUMENTS');

  const [pin] = await sql`SELECT locality_key FROM app.pin_code p WHERE pin_code=${r.pinCode} AND EXISTS (SELECT 1 FROM app.locality l WHERE l.key=p.locality_key)`;
  const qualification = QUALIFICATIONS.find((q) => q.id === r.highestQualification)!.title.en;
  await sql`
    UPDATE app.candidate SET
      name = ${r.fullName}, email = ${r.email}, pin_code = ${r.pinCode}, date_of_birth = ${r.dateOfBirth},
      gender = ${r.gender}, highest_qualification = ${r.highestQualification},
      education = CASE WHEN education = '' THEN ${qualification} ELSE education END,
      experience_months = ${Math.round(r.experienceYears * 12)},
      current_industry = ${r.currentIndustry}, current_job_role = ${r.currentJobRole}, current_company = ${r.currentCompany},
      languages = ${sql.json(r.languagesKnown as never)},
      current_pay_paise = ${r.currentSalary === null ? null : Math.round(r.currentSalary * 100)},
      expected_pay_paise = ${Math.round(r.expectedSalary * 100)},
      locality_key = COALESCE(locality_key, ${pin?.locality_key ?? null}),
      age_confirmed_18 = TRUE,
      registration_channel = COALESCE(registration_channel, 'WHATSAPP_FLOW'),
      status = CASE WHEN status IN ('STARTED','MOBILE_VERIFIED') THEN 'PROFILE_INCOMPLETE' ELSE status END
    WHERE id = ${candidateId}`;

  await sql`INSERT INTO app.candidate_resume (id, candidate_id, object_key, storage, filename, mime, size_bytes, source, uploaded_at)
            VALUES (${await nextId('RES')}, ${candidateId}, ${resume.objectKey}, ${resume.storage}, ${resume.filename.slice(0, 200)}, ${resume.mime}, ${resume.sizeBytes}, 'WHATSAPP', ${at})`;
  await sql`UPDATE app.whatsapp_invite SET status='FORM_SUBMITTED', submitted_at=${at}, candidate_id=${candidateId} WHERE id=${invite.id}`;
  await sql`UPDATE app.message_log SET candidate_id=${candidateId} WHERE invite_id=${invite.id} AND candidate_id IS NULL`;
  await receiveOnInvite(invite.id, '📋 Registration form submitted · 📎 ' + resume.filename.slice(0, 80), candidateId);

  const sent = await messagingProvider().send({ candidateId, templateKey: 'registration_link', language: invite.language, variables: { name: r.fullName.split(' ')[0], link: signInUrl } });
  await sql`UPDATE app.message_log SET invite_id=${invite.id} WHERE id=${sent.id}`;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (${await nextId('AUD')}, ${candidateId}, 'CANDIDATE', 'WHATSAPP_REGISTERED', 'candidate', ${candidateId},
            'Registered through the WhatsApp form', ${sql.json({ inviteId: invite.id, returning: !!existing } as never)}, ${at})`;
  return { candidateId, duplicate: false };
}

// ---------------------------------------------------------------------------
// Webhook signing. The route writes candidate records, so it must be signed.
// ---------------------------------------------------------------------------

function secret() {
  const s = process.env.WHATSAPP_WEBHOOK_SECRET ?? process.env.DEMO_SESSION_SECRET
    ?? (process.env.NODE_ENV !== 'production' ? 'local-demo-only-secret' : '');
  if (!s) throw new Error('Set WHATSAPP_WEBHOOK_SECRET before accepting WhatsApp webhooks.');
  return s;
}
export const signWebhook = (raw: string) => createHmac('sha256', secret()).update(raw).digest('hex');
export function verifyWebhook(raw: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    const a = Buffer.from(signature); const b = Buffer.from(signWebhook(raw));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
