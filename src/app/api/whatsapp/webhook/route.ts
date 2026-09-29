import { handleInviteReply, handleFlowSubmission, verifyWebhook } from '@/modules/registration';
import { FormError } from '@/modules/registration/flow';
import { verifyMetaSignature, isMetaPayload, handleMetaPayload } from '@/modules/adapters/whatsapp-meta';

/**
 * WhatsApp registration webhook.
 *
 * Accepts normalised events, signed with WHATSAPP_WEBHOOK_SECRET:
 *   { type: 'invite_reply', token | phone, accepted, text }
 *   { type: 'flow_submission', token | phone, payload, resume, sign_in_url }
 *
 * The simulator posts here exactly as a production adapter would after
 * translating Meta's payload (and downloading the Flow's DocumentPicker media
 * into storage), so there is one trusted path into a profile, not two. Nothing
 * in the payload may name a candidate: the invite does that.
 *
 * Meta now posts here too, in its own shape, signed its own way. That payload is
 * translated in `@/modules/adapters/whatsapp-meta` and handed to the very same
 * handlers, so the normalised path above is unchanged and remains the only way
 * a profile is written. The two are told apart by which signature header is
 * present, and each is verified against its own secret — neither can be used to
 * smuggle a request past the other.
 */

// Meta's one-time subscription handshake, for when a real number is connected.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === expected) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

const KNOWN = new Set(['UNKNOWN_INVITE', 'INVITE_NOT_ACCEPTED', 'PROFILE_BLOCKED']);

export async function POST(request: Request) {
  const raw = await request.text();

  // Meta's own webhook, signed with the app secret. Anything carrying this
  // header is verified as Meta or refused — it is never allowed to fall
  // through to the internal path and be checked against the other secret.
  const metaSignature = request.headers.get('x-hub-signature-256');
  if (metaSignature) {
    if (!verifyMetaSignature(raw, metaSignature)) {
      return Response.json({ error: 'BAD_SIGNATURE' }, { status: 401 });
    }
    let metaBody: unknown;
    try { metaBody = JSON.parse(raw); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400 }); }
    if (!isMetaPayload(metaBody)) return Response.json({ error: 'UNKNOWN_EVENT' }, { status: 400 });
    try {
      // Always 200 once signed: a non-2xx makes Meta retry the whole batch,
      // including the parts that already applied.
      return Response.json({ ok: true, ...(await handleMetaPayload(metaBody)) });
    } catch (e) {
      console.error('whatsapp meta webhook failed', e);
      return Response.json({ ok: false, error: 'FAILED' });
    }
  }

  if (!verifyWebhook(raw, request.headers.get('x-whatsapp-signature'))) {
    return Response.json({ error: 'BAD_SIGNATURE' }, { status: 401 });
  }
  let body: any;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400 }); }
  const ref = {
    token: typeof body.token === 'string' ? body.token : undefined,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
  };

  try {
    if (body.type === 'invite_reply') {
      return Response.json({ ok: true, ...(await handleInviteReply(ref, body.accepted === true, String(body.text ?? ''))) });
    }
    if (body.type === 'flow_submission') {
      // A resume is optional, but a malformed one is still rejected rather than
      // quietly dropped — that would lose a file the candidate thinks they sent.
      const r = body.resume ?? null;
      if (r !== null && (typeof r.objectKey !== 'string' || typeof r.filename !== 'string' || typeof r.mime !== 'string' || !Number.isFinite(r.sizeBytes))) {
        return Response.json({ error: 'RESUME_MALFORMED' }, { status: 400 });
      }
      const result = await handleFlowSubmission(ref, body.payload ?? {}, r, String(body.sign_in_url ?? '/sign-in'));
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ error: 'UNKNOWN_EVENT' }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'FAILED';
    // Validation messages are written for the candidate; pass them back so the
    // sender can show them. Anything else is an internal failure.
    if (KNOWN.has(message)) return Response.json({ error: message }, { status: 409 });
    if (e instanceof FormError) return Response.json({ error: 'INVALID', message }, { status: 422 });
    console.error('whatsapp webhook failed', e);
    return Response.json({ error: 'FAILED' }, { status: 500 });
  }
}
