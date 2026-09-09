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

export function messagingProvider(): MessagingProvider {
  // WhatsApp Cloud API adapter would be selected here by environment.
  // It is deliberately absent: shipping it would require a Meta business
  // account, an approved WABA and template review, none of which a prototype
  // needs (§21.3).
  return new SimulatorMessagingProvider();
}

/** OTP verification — simulated. Only the documented demo code is accepted. */
export async function verifyOtp(code: string): Promise<boolean> {
  return code === DEMO_OTP;
}
export const DEMO_OTP = '123456';
