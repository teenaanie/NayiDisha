import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { handleInviteReply, handleFlowSubmission, type StoredResume } from '@/modules/registration';
import { storageProvider, checkResume, FileRejected, RESUME_TYPES } from '@/modules/adapters/storage';

/**
 * Translating Meta into the events this application already understands.
 *
 * The registration webhook was written to accept normalised events, on the
 * stated assumption that a production adapter would translate Meta's payload
 * first. This is that translation — so there is still one trusted path into a
 * profile, and `handleInviteReply` / `handleFlowSubmission` never learn that
 * WhatsApp became real.
 *
 * Meta's own shape is doing two unrelated jobs in one payload: what happened to
 * messages we sent, and what a candidate sent us. Both arrive here.
 */

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

/** Meta signs the raw body with the app secret as sha256=<hex>. */
export function verifyMetaSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  // Refuse rather than accept when unconfigured. An open endpoint that writes
  // to candidate records is worse than one that is merely broken.
  if (!secret || !header) return false;
  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

/** Only Meta's own payloads carry this envelope. */
export const isMetaPayload = (body: unknown): boolean =>
  !!body && typeof body === 'object' && (body as { object?: string }).object === 'whatsapp_business_account';

/** Meta's delivery ladder, in the order a message climbs it. */
const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const NORMALISED: Record<string, string> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

async function applyStatus(s: Record<string, any>, at: Date): Promise<boolean> {
  const ref = s?.id;
  const next = String(s?.status ?? '').toLowerCase();
  if (!ref || !(next in NORMALISED)) return false;

  const [row] = await sql<{ id: string; delivery_status: string }[]>`
    SELECT id, delivery_status FROM app.message_log WHERE provider_ref = ${ref}
  `;
  if (!row) return false;
  // Receipts arrive out of order — a 'sent' after a 'read' is normal traffic.
  // A message must never walk back down the ladder.
  if ((RANK[next] ?? -1) <= (RANK[row.delivery_status.toLowerCase()] ?? -1)) return false;

  const failure = next === 'failed'
    ? String(s?.errors?.[0]?.title ?? s?.errors?.[0]?.message ?? 'Delivery failed').slice(0, 300)
    : null;
  await sql`
    UPDATE app.message_log
       SET delivery_status = ${NORMALISED[next]},
           failure_reason  = COALESCE(${failure}, failure_reason),
           billed_category = COALESCE(${s?.pricing?.category ?? null}, billed_category),
           status_at       = ${at}
     WHERE id = ${row.id}
  `;
  return true;
}

/** What the candidate actually said, whichever kind of message they sent. */
function readableText(m: Record<string, any>): string {
  return String(
    m?.text?.body
    ?? m?.button?.text
    ?? m?.interactive?.button_reply?.title
    ?? m?.interactive?.list_reply?.title
    ?? m?.interactive?.nfm_reply?.name
    ?? `[${m?.type ?? 'unsupported'}]`,
  ).slice(0, 4000);
}

/** A tapped button on an invite: accept unless it plainly says no. */
const DECLINE = /^(no|nahi|nako|not now|decline|stop)/i;

/**
 * Pull a Flow's uploaded document out of Meta and into our own storage.
 *
 * Meta holds media behind a two-step, authenticated fetch and expires it, so it
 * cannot be referenced later — it has to be copied while the webhook is
 * handling the message, or it is gone.
 */
async function fetchMedia(mediaId: string, token: string, filename: string): Promise<StoredResume> {
  const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  const info: any = await meta.json();
  if (!meta.ok || !info?.url) throw new FileRejected('Could not read the uploaded file.');

  const bin = await fetch(info.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!bin.ok) throw new FileRejected('Could not download the uploaded file.');
  const bytes = new Uint8Array(await bin.arrayBuffer());

  const mime = String(info.mime_type ?? 'application/octet-stream');
  const name = filename || `resume.${RESUME_TYPES[mime] ?? 'bin'}`;
  // Same size and type rules the browser upload path applies. A file arriving
  // over WhatsApp is not more trustworthy for having come from Meta.
  checkResume(bytes, mime, name);

  const store = storageProvider();
  const key = `whatsapp/${mediaId}/${name}`;
  await store.put(key, bytes, mime);
  return { objectKey: key, storage: store.name, filename: name, mime, sizeBytes: bytes.byteLength };
}

export interface MetaOutcome { statuses: number; inbound: number; routed: string[] }

export async function handleMetaPayload(body: any): Promise<MetaOutcome> {
  const at = await now();
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const out: MetaOutcome = { statuses: 0, inbound: 0, routed: [] };

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};

      for (const s of value.statuses ?? []) {
        if (await applyStatus(s, at)) out.statuses += 1;
      }

      for (const m of value.messages ?? []) {
        const ref = m?.id;
        const from = String(m?.from ?? '');
        if (!ref || !from) continue;

        // Meta retries anything it believes failed, so the same message can
        // arrive more than once. The unique provider_ref makes that harmless.
        const [seen] = await sql<{ id: string }[]>`SELECT id FROM app.inbound_message WHERE provider_ref = ${ref}`;
        if (seen) continue;

        const digits = from.replace(/[^0-9]/g, '');
        const [candidate] = await sql<{ id: string }[]>`
          SELECT id FROM app.candidate
           WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ${digits} AND status <> 'DELETED_BLOCKED' LIMIT 1
        `;
        const [invite] = await sql<{ id: string; status: string }[]>`
          SELECT id, status FROM app.whatsapp_invite
           WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ${digits}
           ORDER BY sent_at DESC LIMIT 1
        `;

        const text = readableText(m);
        const flow = m?.interactive?.nfm_reply;
        let routed: string | null = null;
        let handled: Date | null = null;

        try {
          if (flow && invite) {
            // A submitted Flow carries the form and, separately, a media id.
            const payload = typeof flow.response_json === 'string'
              ? JSON.parse(flow.response_json) : (flow.response_json ?? {});
            const mediaId = payload?.resume_media_id ?? payload?.media_id ?? m?.document?.id;
            if (!mediaId || !token) throw new FileRejected('A resume is required to finish registering.');
            const resume = await fetchMedia(String(mediaId), token, String(payload?.filename ?? ''));
            await handleFlowSubmission({ phone: from }, payload, resume, process.env.WHATSAPP_SIGN_IN_URL ?? '/sign-in');
            routed = 'flow_submission'; handled = at;
          } else if (invite && ['SENT', 'ACCEPTED', 'DECLINED'].includes(invite.status)) {
            await handleInviteReply({ phone: from }, !DECLINE.test(text.trim()), text);
            routed = 'invite_reply'; handled = at;
          }
        } catch (e) {
          // A candidate's reply is never lost because routing it failed. It is
          // recorded unhandled, and Operations can see why.
          routed = `failed:${e instanceof Error ? e.message.slice(0, 80) : 'error'}`;
        }

        await sql`
          INSERT INTO app.inbound_message
            (id, provider_ref, from_phone, candidate_id, invite_id, body, message_type, raw, routed_to, received_at, handled_at)
          VALUES (${await nextId('INB')}, ${ref}, ${from}, ${candidate?.id ?? null}, ${invite?.id ?? null},
                  ${text}, ${String(m?.type ?? 'text')}, ${sql.json(m as never)}, ${routed}, ${at}, ${handled})
        `;
        if (candidate) {
          await sql`
            INSERT INTO app.message_log (id, candidate_id, direction, body, cost_paise, created_at, provider, provider_ref, status_at)
            VALUES (${await nextId('MSG')}, ${candidate.id}, 'INBOUND', ${text}, 0, ${at},
                    'whatsapp-cloud-api@1.0', ${ref}, ${at})
          `;
        }
        out.inbound += 1;
        if (routed) out.routed.push(routed);
      }
    }
  }
  return out;
}
