import { sarvamChat, sarvamConfigured, SARVAM_CHAT_MODEL, type ChatMessage } from './sarvam';
import { recordUsage, anthropicTokens, geminiTokens } from '@/modules/ai-usage';

/**
 * One chat-completion interface over the three providers this codebase knows,
 * so the practice agents do not care which is configured.
 *
 * The two agents want different things, so each gets its own preference order:
 *   customer  — Sarvam first: it has to speak Hindi, Marathi and Tamil naturally.
 *   evaluator — Claude, then Gemini, then Sarvam: it has to grade consistently
 *               against a rubric, in English, at temperature 0.
 * With nothing configured, each agent's caller falls back to its rules.
 */

export interface ChatModel {
  readonly name: string;
  complete(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean; maxTokens?: number }): Promise<string>;
}

class SarvamModel implements ChatModel {
  readonly name = SARVAM_CHAT_MODEL;
  constructor(private feature: string) {}
  complete(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
    return sarvamChat(messages, { ...opts, feature: this.feature });
  }
}

class ClaudeModel implements ChatModel {
  readonly name = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  constructor(private feature: string) {}
  async complete(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
    const started = Date.now();
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.name,
        max_tokens: opts.maxTokens ?? 1200,
        temperature: opts.temperature ?? 0.4,
        system,
        messages: messages.filter((m) => m.role !== 'system'),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      recordUsage({ provider: 'anthropic', model: this.name, feature: this.feature, ok: false, latencyMs: Date.now() - started });
      throw new Error(`${this.name} returned HTTP ${res.status}`);
    }
    const body = await res.json();
    recordUsage({ provider: 'anthropic', model: this.name, feature: this.feature, ...anthropicTokens(body), latencyMs: Date.now() - started });
    return String(body?.content?.[0]?.text ?? '');
  }
}

class GeminiModel implements ChatModel {
  readonly name = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  constructor(private feature: string) {}
  async complete(messages: ChatMessage[], opts: { temperature?: number; json?: boolean; maxTokens?: number } = {}) {
    const started = Date.now();
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.name}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: {
            temperature: opts.temperature ?? 0.4,
            maxOutputTokens: opts.maxTokens ?? 1200,
            ...(opts.json ? { responseMimeType: 'application/json' } : {}),
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) {
      recordUsage({ provider: 'gemini', model: this.name, feature: this.feature, ok: false, latencyMs: Date.now() - started });
      throw new Error(`${this.name} returned HTTP ${res.status}`);
    }
    const body = await res.json();
    recordUsage({ provider: 'gemini', model: this.name, feature: this.feature, ...geminiTokens(body), latencyMs: Date.now() - started });
    return String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  }
}

/** `feature` labels the calls on the token meter (/ops/ai-usage). */
const available = {
  sarvam: (feature: string) => (sarvamConfigured() ? new SarvamModel(feature) : null),
  claude: (feature: string) => (process.env.ANTHROPIC_API_KEY ? new ClaudeModel(feature) : null),
  gemini: (feature: string) => (process.env.GEMINI_API_KEY ? new GeminiModel(feature) : null),
};

export function customerModel(): ChatModel | null {
  const f = 'practice.customer';
  return available.sarvam(f) ?? available.claude(f) ?? available.gemini(f);
}

export function evaluatorModel(): ChatModel | null {
  const f = 'practice.evaluator';
  return available.claude(f) ?? available.gemini(f) ?? available.sarvam(f);
}

/** Models wrap JSON in prose or fences more often than they should. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
