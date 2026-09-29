'use server';
import { headers } from 'next/headers';
import { now } from '@/lib/clock';
import { randomToken } from '@/lib/ids';
import { inviteByToken, signWebhook } from '@/modules/registration';
import { validateSubmission, FormError, REGISTRATION_FLOW } from '@/modules/registration/flow';
import { storageProvider, checkResume, RESUME_TYPES, FileRejected } from '@/modules/adapters/storage';

/**
 * The simulator's side of WhatsApp self-registration. It plays the part of the
 * provider adapter: it turns what the "phone" sent into normalised events and
 * posts them, signed, to the same webhook a real WhatsApp number would use.
 *
 * The invite token stands in for WhatsApp's own authentication of the sender.
 * Errors are returned, not thrown, so the candidate sees the real message.
 */

async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  return process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
}

async function post(event: Record<string, unknown>): Promise<{ error?: string }> {
  const raw = JSON.stringify(event);
  const res = await fetch(`${await origin()}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-whatsapp-signature': signWebhook(raw) },
    body: raw,
    cache: 'no-store',
  });
  if (res.ok) return {};
  const body = await res.json().catch(() => ({}));
  if (body?.message) return { error: body.message };
  if (body?.error === 'INVITE_NOT_ACCEPTED') return { error: 'Reply “Yes” to the invitation before sending the form.' };
  if (body?.error === 'PROFILE_BLOCKED') return { error: 'This number cannot be registered. Please contact NayiDisha support.' };
  return { error: 'We could not save your reply. Please try again.' };
}

export async function replyToInvite(token: string, accepted: boolean, text: string) {
  if (!(await inviteByToken(token))) return { error: 'This invitation link is not valid.' };
  return post({ type: 'invite_reply', token, accepted, text });
}

const MULTI = new Set(REGISTRATION_FLOW.flatMap((s) => s.fields).filter((f) => f.kind === 'checkboxes').map((f) => f.name));

export async function submitRegistration(token: string, form: FormData) {
  const invite = await inviteByToken(token);
  if (!invite) return { error: 'This invitation link is not valid.' };

  const payload: Record<string, unknown> = {};
  for (const field of REGISTRATION_FLOW.flatMap((s) => s.fields)) {
    if (field.kind === 'document') continue;
    payload[field.name] = MULTI.has(field.name) ? form.getAll(field.name).map(String) : form.get(field.name) ?? '';
  }
  try {
    // Check the answers before storing anything, so a typo never leaves an orphaned file.
    validateSubmission(payload, await now());
    // The resume is optional: someone scanning a QR at a shop rarely has a file
    // on their phone, and turning them away costs more than the document is
    // worth. A file that IS attached still has to pass the same checks.
    const file = form.get('resume');
    let resume: { objectKey: string; storage: string; filename: string; mime: string; sizeBytes: number } | null = null;
    if (file instanceof File && file.size) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = checkResume(bytes, file.type, file.name);
      const store = storageProvider();
      const objectKey = `resumes/${invite.id}/${randomToken(12)}.${RESUME_TYPES[mime]}`;
      await store.put(objectKey, bytes, mime);
      resume = { objectKey, storage: store.name, filename: file.name || 'resume', mime, sizeBytes: bytes.length };
    }
    return post({
      type: 'flow_submission', token, payload, resume,
      sign_in_url: `${await origin()}/sign-in`,
    });
  } catch (e) {
    if (e instanceof FormError || e instanceof FileRejected) return { error: e.message };
    console.error('registration submit failed', e);
    return { error: 'We could not send your details. Please try again.' };
  }
}

/**
 * Interpret one spoken answer on an invite, before any candidate exists.
 *
 * The profile journey's version requires a signed-in CANDIDATE. Here the invite
 * token is the only identity there is, so it is what authorises the call — and
 * it is checked on every turn rather than trusted from the first one.
 *
 * Some fields are deliberately not offered by voice. An email spelled aloud is
 * one recognition slip away from a candidate nobody can contact; a date of
 * birth read back wrong is a silent age-gate failure; and consent has to be a
 * deliberate tap, for the same reason the profile journey keeps its two legal
 * declarations as checkboxes.
 */
export async function interpretInviteField(token: string, field: string, transcript: string, language: string) {
  const invite = await inviteByToken(String(token));
  if (!invite) return { error: 'This invitation is no longer open.' as const };
  if (typeof transcript !== 'string' || !transcript.trim()) return { error: 'Nothing was heard. Please try again.' as const };
  if (transcript.length > 2000) return { error: 'That answer was too long.' as const };

  const { VOICE_FIELD_SPECS } = await import('@/modules/registration/flow');
  const spec = VOICE_FIELD_SPECS[field];
  if (!spec) return { error: 'That question cannot be answered by voice.' as const };

  const lang = (['en', 'hi', 'mr'] as const).includes(language as 'en') ? (language as 'en' | 'hi' | 'mr') : 'en';
  const { voiceInterpreter, interpreterContext, CONFIRM_THRESHOLD, RuleBasedInterpreter } = await import('@/modules/adapters/voice');
  const base = await interpreterContext();
  const ctx = { ...base, spec };

  // Rules first, model only when they cannot read it — the same economy the
  // role scripts use, because the free model quota is small and per day.
  const simple = spec.dataType === 'ENUM';
  // `via` routes to a profile-journey handler that already knows this shape.
  const readAs = spec.via ?? field;
  let r = await (simple ? new RuleBasedInterpreter() : voiceInterpreter()).interpret(readAs, transcript.trim(), lang, ctx);
  if (simple && r.value === null) {
    const model = voiceInterpreter();
    if (model.name !== 'rule-based@1.0') r = await model.interpret(readAs, transcript.trim(), lang, ctx);
  }

  let value = r.value;
  let display = r.display;
  // Those handlers answer in their own units; convert to the form's.
  if (spec.via === 'experienceMonths' && typeof value === 'number') {
    value = Math.round(value / 12);
    display = `${value} year(s)`;
  }
  if (spec.via === 'skills' && Array.isArray(value)) {
    value = value.join(', ');
    display = String(value);
  }
  // A pin code is six digits or it is nothing: a half-heard one silently sends
  // the candidate to the wrong city, so refuse rather than guess.
  if (field === 'pin_code' && !/^[1-9][0-9]{5}$/.test(String(value ?? ''))) {
    return { value: null, display: '', confidence: 0, needsConfirmation: true, understood: false };
  }
  return {
    value, display, confidence: r.confidence,
    needsConfirmation: r.confidence < CONFIRM_THRESHOLD || value === null,
    understood: value !== null,
  };
}
