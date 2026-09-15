import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Screening-call provider (§13 adapter rule).
 *
 * A candidate scans a QR, consents, and is screened by a voice agent. Who runs
 * that agent is a deployment choice, not a domain concern — the journey, the
 * consent gate, the result shape and the profile update are identical either
 * way.
 *
 * Why the default is in-browser rather than a real call: placing automated
 * commercial calls to Indian mobiles requires the business to be registered as
 * a Principal Entity on a TRAI DLT platform, with registered caller IDs and
 * templates. No vendor can hand that to you on a free tier, so a telephony
 * default would make this feature untestable by anyone without a registered
 * company. The browser provider gives the same conversation and the same
 * structured result at no cost and outside that regime.
 */

export type Language = 'en' | 'hi' | 'mr';

export interface ScreeningRequest {
  callId: string;              // our id, echoed back by the provider
  candidateId: string;
  phone: string;
  name: string | null;
  language: Language;
  /** Answers the agent should come back with. */
  wanted: string[];
}

export interface ScreeningResult {
  callId: string;
  providerRef: string | null;
  status: 'COMPLETED' | 'FAILED' | 'NO_ANSWER' | 'IN_PROGRESS';
  extracted: Record<string, unknown>;
  summary: string | null;
  /** Null when no audio was ever created — which is the point of the browser provider. */
  recordingRef: string | null;
  durationSec: number | null;
}

export interface ScreeningProvider {
  readonly name: string;
  /** True when the conversation happens in the candidate's browser rather than over a phone line. */
  readonly inBrowser: boolean;
  /** Ask for the screening. Returns the provider's own reference, if it has one. */
  request(req: ScreeningRequest): Promise<{ providerRef: string | null; accepted: boolean; reason?: string }>;
}

// ---------------------------------------------------------------------------
// Tier 1 — the browser is the handset. Free, no signup, no telecom regulator.
// ---------------------------------------------------------------------------

export class BrowserScreeningProvider implements ScreeningProvider {
  readonly name = 'browser-voice@1.0';
  readonly inBrowser = true;
  async request(): Promise<{ providerRef: null; accepted: true }> {
    // Nothing to dial. The client runs the conversation and posts the result
    // back through the same webhook a vendor would use.
    return { providerRef: null, accepted: true };
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — Raya (getraya.app). Real outbound telephony for Indian languages.
// ---------------------------------------------------------------------------

/**
 * NOT YET VERIFIED AGAINST RAYA'S DOCS.
 *
 * Raya's API reference (docs.litwizlabs.com) is not public — it returns 403 —
 * so the endpoint path, field names and auth header below are placeholders,
 * NOT a contract anyone has confirmed. They are deliberately isolated here so
 * that filling them in from the real documentation is a single edit and touches
 * nothing else.
 *
 * Ask Raya for: base URL, auth header format, the outbound-call endpoint and
 * its request schema, the webhook payload, and how webhook signatures are
 * computed. Then correct RAYA_ENDPOINT, the body below, and verifySignature.
 */
const RAYA_ENDPOINT = process.env.RAYA_API_URL ?? 'https://api.getraya.app/v1/calls';

export class RayaScreeningProvider implements ScreeningProvider {
  readonly name = 'raya';
  readonly inBrowser = false;

  async request(req: ScreeningRequest) {
    const key = process.env.RAYA_API_KEY;
    if (!key) return { providerRef: null, accepted: false, reason: 'RAYA_API_KEY is not set.' };
    try {
      const res = await fetch(RAYA_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          phone_number: req.phone,
          agent_id: process.env.RAYA_AGENT_ID,
          candidate_name: req.name,
          initial_language: req.language,
          // Echo our id so the webhook can be tied back to the right candidate
          // without trusting anything else in the payload.
          custom_variables: { call_id: req.callId, candidate_id: req.candidateId },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { providerRef: null, accepted: false, reason: `Raya returned ${res.status}` };
      const json = await res.json().catch(() => ({}));
      return { providerRef: json?.call_id ?? null, accepted: true };
    } catch (e) {
      return { providerRef: null, accepted: false, reason: e instanceof Error ? e.message : 'Raya unreachable' };
    }
  }
}

export function screeningProvider(): ScreeningProvider {
  return process.env.SCREENING_PROVIDER === 'raya'
    ? new RayaScreeningProvider()
    : new BrowserScreeningProvider();
}

/**
 * Webhook authenticity.
 *
 * The webhook writes to a candidate's profile, so an unauthenticated endpoint
 * would let anyone on the internet rewrite anyone's details. Verified with an
 * HMAC over the raw body and a constant-time compare.
 *
 * The browser provider signs with the same secret, so the trusted path is the
 * same one in development and production rather than a bypass that only exists
 * in dev and rots.
 */
export function signPayload(raw: string): string {
  const secret = process.env.SCREENING_WEBHOOK_SECRET
    ?? process.env.DEMO_SESSION_SECRET
    ?? (process.env.NODE_ENV !== 'production' ? 'local-demo-only-secret' : '');
  if (!secret) throw new Error('Set SCREENING_WEBHOOK_SECRET before accepting screening webhooks.');
  return createHmac('sha256', secret).update(raw).digest('hex');
}

export function verifySignature(raw: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    const expected = signPayload(raw);
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
