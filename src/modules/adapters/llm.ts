import { sarvamChat, sarvamConfigured, type ChatMessage } from './sarvam';

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
  readonly name = process.env.SARVAM_CHAT_MODEL || 'sarvam-m';
  complete(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
    return sarvamChat(messages, opts);
  }
}

class ClaudeModel implements ChatModel {
  readonly name = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  async complete(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
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
    if (!res.ok) throw new Error(`${this.name} returned HTTP ${res.status}`);
    const body = await res.json();
    return String(body?.content?.[0]?.text ?? '');
  }
}

class GeminiModel implements ChatModel {
  readonly name = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  async complete(messages: ChatMessage[], opts: { temperature?: number; json?: boolean; maxTokens?: number } = {}) {
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
    if (!res.ok) throw new Error(`${this.name} returned HTTP ${res.status}`);
    const body = await res.json();
    return String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  }
}

const available = {
  sarvam: () => (sarvamConfigured() ? new SarvamModel() : null),
  claude: () => (process.env.ANTHROPIC_API_KEY ? new ClaudeModel() : null),
  gemini: () => (process.env.GEMINI_API_KEY ? new GeminiModel() : null),
};

export function customerModel(): ChatModel | null {
  return available.sarvam() ?? available.claude() ?? available.gemini();
}

export function evaluatorModel(): ChatModel | null {
  return available.claude() ?? available.gemini() ?? available.sarvam();
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
