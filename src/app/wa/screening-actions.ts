'use server';
import { sql } from '@/lib/db';
import { requireRole, auditAction } from '@/lib/auth';
import { nextId } from '@/lib/ids';
import { now } from '@/lib/clock';
import { choice } from '@/lib/validation';
import { grantConsent } from '@/modules/candidate';
import { screeningProvider, signPayload, type Language } from '@/modules/adapters/screening';

const WANTED = ['name', 'locality', 'experienceMonths', 'skills', 'expectedPay', 'commute', 'shifts'];

/** Has this candidate agreed to be screened by a voice agent? */
export async function hasScreeningConsent() {
  const c = await requireRole(['CANDIDATE']);
  const [row] = await sql`
    SELECT 1 FROM app.consent_record
     WHERE candidate_id=${c.id} AND purpose='VOICE_SCREENING'
       AND granted_at IS NOT NULL AND withdrawn_at IS NULL`;
  return !!row;
}

export async function grantScreeningConsent() {
  const c = await requireRole(['CANDIDATE']);
  await grantConsent(c.id, 'VOICE_SCREENING' as never);
  await auditAction('VOICE_SCREENING_CONSENT_GRANTED', [c.id]);
}

/**
 * Start a screening. Refuses without consent — an automated call placed
 * without agreement is the exact thing the consent purpose exists to prevent.
 */
export async function startScreening(language: string, siteId?: string) {
  const c = await requireRole(['CANDIDATE']);
  const lang = choice(language, ['en', 'hi', 'mr'] as const, 'language') as Language;

  const [cand] = await sql<{ phone: string; name: string | null }[]>`
    SELECT phone, name FROM app.candidate WHERE id=${c.id}`;
  const provider = screeningProvider();
  const id = await nextId('SCR');
  const at = await now();

  if (!(await hasScreeningConsent())) {
    await sql`INSERT INTO app.screening_call (id,candidate_id,partner_site_id,provider,language,status,status_reason,requested_at)
              VALUES (${id},${c.id},${siteId ?? null},${provider.name},${lang},'CONSENT_MISSING','No VOICE_SCREENING consent',${at})`;
    throw new Error('Please agree to the screening call first.');
  }

  await sql`INSERT INTO app.screening_call (id,candidate_id,partner_site_id,provider,language,status,requested_at)
            VALUES (${id},${c.id},${siteId ?? null},${provider.name},${lang},'REQUESTED',${at})`;

  const res = await provider.request({
    callId: id, candidateId: c.id, phone: cand.phone, name: cand.name, language: lang, wanted: WANTED,
  });

  if (!res.accepted) {
    await sql`UPDATE app.screening_call SET status='FAILED',status_reason=${res.reason ?? 'Provider refused'} WHERE id=${id}`;
    throw new Error(res.reason ?? 'The screening service is unavailable.');
  }
  if (res.providerRef) await sql`UPDATE app.screening_call SET provider_ref=${res.providerRef},status='IN_PROGRESS' WHERE id=${id}`;

  await auditAction('SCREENING_REQUESTED', [c.id]);
  return { callId: id, inBrowser: provider.inBrowser, provider: provider.name };
}

/**
 * Report a browser-run screening through the same signed webhook a vendor
 * uses, so there is one trusted path into a profile rather than two.
 */
export async function submitBrowserScreening(callId: string, extracted: Record<string, unknown>, summary: string) {
  await requireRole(['CANDIDATE']);
  const payload = JSON.stringify({
    call_id: callId, status: 'COMPLETED', extracted, summary,
    provider_ref: null, recording_ref: null, duration_sec: null,
  });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? (process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL}`)
    : 'http://127.0.0.1:3000';
  const res = await fetch(`${base}/api/screening/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-screening-signature': signPayload(payload) },
    body: payload,
  });
  if (!res.ok) throw new Error('Could not save the screening result.');
  return { ok: true };
}
