import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { verifySignature } from '@/modules/adapters/screening';
import { safelyRefreshCandidate } from '@/modules/discovery';
import { after } from 'next/server';

/**
 * Screening result webhook.
 *
 * Whoever ran the conversation — an outbound vendor or the candidate's own
 * browser — reports the outcome here, and this is the only place a screening
 * result is allowed to touch a profile.
 *
 * It is signed. This endpoint writes to candidate records, so without a
 * signature check anyone who found the URL could rewrite anyone's profile.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-screening-signature'))) {
    return Response.json({ error: 'BAD_SIGNATURE' }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400 }); }

  const callId = String(body.call_id ?? '');
  if (!callId) return Response.json({ error: 'CALL_ID_REQUIRED' }, { status: 400 });

  // The call row is the source of truth for whose profile this is. Nothing in
  // the payload is trusted to name a candidate.
  const [call] = await sql<{ id: string; candidate_id: string; status: string }[]>`
    SELECT id, candidate_id, status FROM app.screening_call WHERE id = ${callId}
  `;
  if (!call) return Response.json({ error: 'UNKNOWN_CALL' }, { status: 404 });
  if (call.status === 'COMPLETED') return Response.json({ ok: true, duplicate: true });

  const status = ['COMPLETED', 'FAILED', 'NO_ANSWER', 'IN_PROGRESS'].includes(body.status)
    ? body.status : 'FAILED';
  const extracted = (body.extracted && typeof body.extracted === 'object') ? body.extracted : {};
  const at = await now();

  await sql`
    UPDATE app.screening_call
       SET status = ${status}, provider_ref = ${body.provider_ref ?? null},
           extracted = ${sql.json(extracted as never)}, summary = ${body.summary ?? null},
           recording_ref = ${body.recording_ref ?? null},
           duration_sec = ${Number.isFinite(Number(body.duration_sec)) ? Math.round(Number(body.duration_sec)) : null},
           completed_at = ${status === 'IN_PROGRESS' ? null : at}
     WHERE id = ${callId}
  `;

  if (status === 'COMPLETED') {
    // Only fields the screening is allowed to set, and only when present —
    // a partial call must never blank out details already captured.
    const set: Record<string, unknown> = {};
    if (typeof extracted.name === 'string' && extracted.name.trim()) set.name = extracted.name.trim();
    if (typeof extracted.locality === 'string') set.locality_key = extracted.locality;
    if (Number.isFinite(Number(extracted.experienceMonths))) set.experience_months = Math.round(Number(extracted.experienceMonths));
    if (Number.isFinite(Number(extracted.expectedPay))) set.expected_pay_paise = Math.round(Number(extracted.expectedPay)) * 100;
    if (Number.isFinite(Number(extracted.commute))) set.max_commute_min = Math.round(Number(extracted.commute));

    if (Object.keys(set).length) {
      await sql`UPDATE app.candidate SET ${sql(set)} WHERE id = ${call.candidate_id}`;
    }
    if (Array.isArray(extracted.skills) && extracted.skills.length) {
      await sql`UPDATE app.candidate SET experience_tags = ${sql.json(extracted.skills as never)} WHERE id = ${call.candidate_id}`;
    }
    if (Array.isArray(extracted.shifts) && extracted.shifts.length) {
      await sql`UPDATE app.candidate SET shift_availability = ${sql.json(extracted.shifts as never)} WHERE id = ${call.candidate_id}`;
    }

    await sql`
      INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
      VALUES (${await nextId('AUD')}, ${call.candidate_id}, 'CANDIDATE', 'SCREENING_COMPLETED',
              'screening_call', ${callId}, 'Voice screening result applied',
              ${sql.json({ fields: Object.keys(set) } as never)}, ${at})
    `;
    // Re-match on the new details, after the response — never block the vendor.
    after(() => safelyRefreshCandidate(call.candidate_id));
  }

  return Response.json({ ok: true });
}
