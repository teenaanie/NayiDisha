import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';

/**
 * MessagingProvider (§10.1, §13, §21.2)
 *
 * The simulator and the production WhatsApp Cloud API adapter consume and emit
 * the same normalised conversation events — a §25 acceptance criterion. The
 * simulator writes to message_log and renders in the WhatsApp simulator UI;
 * the production adapter would POST to Meta. Neither is allowed to reach a
 * real recipient in demo mode.
 */
export type TemplateCategory = 'SERVICE' | 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export interface OutboundMessage {
  candidateId: string;
  templateKey: string;
  language: string;
  variables?: Record<string, string>;
}

export interface NormalisedEvent {
  id: string;
  candidateId: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  category: TemplateCategory | null;
  createdAt: Date;
}

/**
 * Modelled per-message cost in paise (India, post 1 Jul 2025 per-message
 * pricing). Recorded so the funnel dashboard can show what the channel would
 * cost in production. Nothing is ever charged in demo mode.
 */
const COST_PAISE: Record<TemplateCategory, number> = {
  SERVICE: 0,          // inside a customer-initiated 24h window
  UTILITY: 12,         // ~₹0.115
  AUTHENTICATION: 12,
  MARKETING: 86,       // ~₹0.8631
};

export interface MessagingProvider {
  readonly name: string;
  send(msg: OutboundMessage): Promise<NormalisedEvent>;
  receive(candidateId: string, body: string): Promise<NormalisedEvent>;
}

function render(body: string, vars: Record<string, string> = {}): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export class SimulatorMessagingProvider implements MessagingProvider {
  readonly name = 'whatsapp-simulator@1.0';

  async send(msg: OutboundMessage): Promise<NormalisedEvent> {
    const [candidate]=await sql`SELECT language FROM app.candidate WHERE id=${msg.candidateId}`;
    msg={...msg,language:candidate?.language||msg.language};
    const [flags]=await sql`SELECT messaging_failure FROM app.demo_clock WHERE id=1`;
    const [tpl] = await sql<{ body: string; category: TemplateCategory }[]>`
      SELECT body, category FROM app.message_template
       WHERE key = ${msg.templateKey}
         AND language = ${msg.language}
    `;
    const fallback = await sql<{ body: string; category: TemplateCategory }[]>`
      SELECT body, category FROM app.message_template
       WHERE key = ${msg.templateKey} AND language = 'en'
    `;
    const chosen = tpl ?? fallback[0];
    if (!chosen) throw new Error(`No template ${msg.templateKey} in ${msg.language} or en`);

    const at = await now();
    const id = await nextId('MSG');
    const body = render(chosen.body, msg.variables);

    await sql`
      INSERT INTO app.message_log
        (id, candidate_id, direction, template_key, language, category, body, cost_paise, created_at,delivery_status,failure_reason)
      VALUES
        (${id}, ${msg.candidateId}, 'OUTBOUND', ${msg.templateKey}, ${msg.language},
         ${chosen.category}, ${body}, ${flags?.messaging_failure?0:COST_PAISE[chosen.category]}, ${at},${flags?.messaging_failure?'FAILED':'DELIVERED'},${flags?.messaging_failure?'SIMULATED_DELIVERY_FAILURE':null})
    `;
    return {
      id, candidateId: msg.candidateId, direction: 'OUTBOUND',
      body, category: chosen.category, createdAt: at,
    };
  }

  async receive(candidateId: string, body: string): Promise<NormalisedEvent> {
    const at = await now();
    const id = await nextId('MSG');
    await sql`
      INSERT INTO app.message_log
        (id, candidate_id, direction, body, cost_paise, created_at)
      VALUES (${id}, ${candidateId}, 'INBOUND', ${body}, 0, ${at})
    `;
    return { id, candidateId, direction: 'INBOUND', body, category: null, createdAt: at };
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

export interface CloudApiConfig { phoneNumberId: string; accessToken: string; wabaId?: string }

/** Configured only when every value a real send needs is present. */
export function cloudApiConfig(): CloudApiConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken, wabaId: process.env.WHATSAPP_WABA_ID };
}

/**
 * Template variables are named here ({{employer}}) and positional at Meta
 * ({{1}}). The seeded body is the contract: the order its placeholders first
 * appear is the order Meta substitutes, so both sides read that order off the
 * same string rather than keeping a second list in step with it.
 */
export function orderedPlaceholders(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Meta's template names: lowercase, digits and underscores only. */
export const metaTemplateName = (key: string, language: string) =>
  `${key}_${language}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

/**
 * Real WhatsApp, through Meta's Cloud API.
 *
 * Emits the simulator's normalised events and writes the same message_log row,
 * so nothing downstream can tell which one ran. What differs is certainty: the
 * simulator knew a message arrived, this one only knows Meta accepted it. A row
 * starts ACCEPTED and the webhook moves it along as receipts come in.
 */
export class CloudApiMessagingProvider implements MessagingProvider {
  readonly name = 'whatsapp-cloud-api@1.0';
  constructor(private cfg: CloudApiConfig) {}

  async send(msg: OutboundMessage): Promise<NormalisedEvent> {
    const [candidate] = await sql<{ language: string; phone: string; status: string }[]>`
      SELECT language, phone, status FROM app.candidate WHERE id = ${msg.candidateId}
    `;
    if (!candidate) throw new Error(`Unknown candidate ${msg.candidateId}`);
    // A deleted or blocked profile is never messaged, whatever asked.
    if (candidate.status === 'DELETED_BLOCKED') throw new Error('This profile is no longer active.');

    // The candidate's own language wins over the caller's: somebody who chose
    // Marathi must not be sent English because a call site hard-coded it.
    const language = candidate.language || msg.language;
    const [tpl] = await sql<{ body: string; category: TemplateCategory }[]>`
      SELECT body, category FROM app.message_template WHERE key = ${msg.templateKey} AND language = ${language}
    `;
    const [fallback] = await sql<{ body: string; category: TemplateCategory }[]>`
      SELECT body, category FROM app.message_template WHERE key = ${msg.templateKey} AND language = 'en'
    `;
    const chosen = tpl ?? fallback;
    if (!chosen) throw new Error(`No template ${msg.templateKey} in ${language} or en`);

    const at = await now();
    const id = await nextId('MSG');
    const body = render(chosen.body, msg.variables);
    const params = orderedPlaceholders(chosen.body).map((k) => ({ type: 'text', text: msg.variables?.[k] ?? '' }));

    let providerRef: string | null = null;
    let status = 'ACCEPTED';
    let failure: string | null = null;
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${this.cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.accessToken}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: candidate.phone.replace(/[^0-9]/g, ''),
          type: 'template',
          template: {
            name: metaTemplateName(msg.templateKey, language),
            language: { code: language },
            ...(params.length ? { components: [{ type: 'body', parameters: params }] } : {}),
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const json: Record<string, any> = await res.json().catch(() => ({}));
      if (res.ok) providerRef = json?.messages?.[0]?.id ?? null;
      else {
        status = 'FAILED';
        // Meta's own words, so an operator is not decoding a status code.
        failure = String(json?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
      }
    } catch (e) {
      status = 'FAILED';
      failure = e instanceof Error && e.name === 'TimeoutError' ? 'Cloud API timed out' : 'Cloud API unreachable';
    }

    // The row is written whatever happened: a message that failed to send is a
    // fact the funnel needs, not something to discard.
    await sql`
      INSERT INTO app.message_log
        (id, candidate_id, direction, template_key, language, category, body,
         cost_paise, created_at, delivery_status, failure_reason, provider_ref, provider, status_at)
      VALUES
        (${id}, ${msg.candidateId}, 'OUTBOUND', ${msg.templateKey}, ${language}, ${chosen.category}, ${body},
         ${status === 'FAILED' ? 0 : COST_PAISE[chosen.category]}, ${at}, ${status}, ${failure},
         ${providerRef}, ${this.name}, ${at})
    `;
    if (status === 'FAILED') throw new Error(failure ?? 'WhatsApp send failed');
    return { id, candidateId: msg.candidateId, direction: 'OUTBOUND', body, category: chosen.category, createdAt: at };
  }

  /** Inbound arrives by webhook; this records one the way the simulator does. */
  async receive(candidateId: string, body: string): Promise<NormalisedEvent> {
    const at = await now();
    const id = await nextId('MSG');
    await sql`
      INSERT INTO app.message_log (id, candidate_id, direction, body, cost_paise, created_at, provider, status_at)
      VALUES (${id}, ${candidateId}, 'INBOUND', ${body}, 0, ${at}, ${this.name}, ${at})
    `;
    return { id, candidateId, direction: 'INBOUND', body, category: null, createdAt: at };
  }
}

/**
 * Real WhatsApp only when it is both configured and explicitly switched on.
 *
 * Credentials alone are not enough. WHATSAPP_LIVE=true is a second, deliberate
 * act, because the failure mode here is messaging real people from a demo, and
 * a stray environment variable should not be able to cause that by itself.
 */
export function messagingProvider(): MessagingProvider {
  const cfg = cloudApiConfig();
  if (cfg && process.env.WHATSAPP_LIVE === 'true') return new CloudApiMessagingProvider(cfg);
  return new SimulatorMessagingProvider();
}

/**
 * Messages on an invite thread, before any candidate exists (WhatsApp
 * self-registration). Same templates, same modelled cost, keyed by invite.
 * A production adapter would send these to the invite's phone number.
 */
export async function sendInviteTemplate(inviteId: string, templateKey: string, language: string, variables: Record<string, string> = {}) {
  const [tpl] = await sql<{ body: string; category: TemplateCategory; buttons: string[] }[]>`
    SELECT body, category, buttons FROM app.message_template
     WHERE key = ${templateKey} AND language IN (${language}, 'en')
     ORDER BY (language = ${language}) DESC LIMIT 1`;
  if (!tpl) throw new Error(`No template ${templateKey}`);
  const at = await now();
  const body = render(tpl.body, variables);
  await sql`
    INSERT INTO app.message_log (id, invite_id, direction, template_key, language, category, body, cost_paise, created_at)
    VALUES (${await nextId('MSG')}, ${inviteId}, 'OUTBOUND', ${templateKey}, ${language}, ${tpl.category}, ${body}, ${COST_PAISE[tpl.category]}, ${at})`;
  return { body, buttons: tpl.buttons ?? [] };
}

export async function receiveOnInvite(inviteId: string, body: string, candidateId: string | null = null) {
  await sql`
    INSERT INTO app.message_log (id, invite_id, candidate_id, direction, body, cost_paise, created_at)
    VALUES (${await nextId('MSG')}, ${inviteId}, ${candidateId}, 'INBOUND', ${body}, 0, ${await now()})`;
}

/**
 * OTP provider. Sign-in goes through this rather than comparing a code
 * inline, so an SMS gateway or a WhatsApp AUTHENTICATION template can replace
 * the simulator without touching the sign-in pages. In India a real SMS OTP
 * also needs DLT registration of the sender and template.
 */
export interface OtpProvider {
  readonly name: string;
  send(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}

class SimulatedOtpProvider implements OtpProvider {
  readonly name = 'otp-simulator@1.0';
  async send() { /* nothing leaves the building; the code is documented */ }
  async verify(_phone: string, code: string) { return code === DEMO_OTP; }
}

export function otpProvider(): OtpProvider {
  return new SimulatedOtpProvider();
}

/** OTP verification — simulated. Only the documented demo code is accepted. */
export async function verifyOtp(code: string, phone = ''): Promise<boolean> {
  return otpProvider().verify(phone, code);
}
export const DEMO_OTP = '123456';
