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
    const file = form.get('resume');
    if (!(file instanceof File) || !file.size) throw new FormError('Attach your resume (PDF or Word).');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = checkResume(bytes, file.type, file.name);
    const store = storageProvider();
    const objectKey = `resumes/${invite.id}/${randomToken(12)}.${RESUME_TYPES[mime]}`;
    await store.put(objectKey, bytes, mime);
    return post({
      type: 'flow_submission', token, payload,
      resume: { objectKey, storage: store.name, filename: file.name || 'resume', mime, sizeBytes: bytes.length },
      sign_in_url: `${await origin()}/sign-in`,
    });
  } catch (e) {
    if (e instanceof FormError || e instanceof FileRejected) return { error: e.message };
    console.error('registration submit failed', e);
    return { error: 'We could not send your details. Please try again.' };
  }
}
