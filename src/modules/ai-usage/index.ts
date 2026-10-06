import { after } from 'next/server';
import { sql } from '@/lib/db';

/**
 * Token meter: every adapter that calls a paid AI provider reports here, and
 * /ops/ai-usage adds it up. Metering must never cost a candidate their turn, so
 * a failed write is dropped silently, and the write runs after the response
 * where Next allows it (outside a request, e.g. the roleplay worker, it just
 * runs in the background). AI_METER=0 turns it off.
 */
export interface UsageEvent {
  provider: 'anthropic' | 'gemini' | 'sarvam' | 'openai_compatible';
  model: string;
  /** What the call was for, e.g. 'practice.customer'. Shown as-is on the meter. */
  feature: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  characters?: number;
  audioSeconds?: number | null;
  ok?: boolean;
  latencyMs?: number;
}

export function recordUsage(e: UsageEvent): void {
  if (process.env.AI_METER === '0') return;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  const write = () => sql`
    INSERT INTO app.ai_usage (provider, model, feature, input_tokens, cached_tokens, output_tokens, characters, audio_seconds, ok, latency_ms)
    VALUES (${e.provider}, ${e.model}, ${e.feature}, ${n(e.inputTokens)}, ${n(e.cachedTokens)}, ${n(e.outputTokens)}, ${n(e.characters)},
            ${e.audioSeconds ?? null}, ${e.ok ?? true}, ${e.latencyMs ?? null})`
    .then(() => {}, () => {});
  try { after(write); } catch { void write(); }
}

type Tokens = Pick<UsageEvent, 'inputTokens' | 'cachedTokens' | 'outputTokens'>;

/** Anthropic Messages API `usage`. Cache writes are counted as ordinary input. */
export function anthropicTokens(body: any): Tokens {
  const u = body?.usage ?? {};
  return { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cachedTokens: u.cache_read_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
}

/** Gemini `usageMetadata`. Thinking tokens bill as output. */
export function geminiTokens(body: any): Tokens {
  const u = body?.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  return { inputTokens: (u.promptTokenCount ?? 0) - cached, cachedTokens: cached, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

/** OpenAI-style chat-completions `usage` (Sarvam chat, the roleplay provider). */
export function openaiTokens(body: any): Tokens {
  const u = body?.usage ?? {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return { inputTokens: (u.prompt_tokens ?? 0) - cached, cachedTokens: cached, outputTokens: billedOutputTokens(u) };
}

/**
 * Output tokens as billed. Gemini's OpenAI-compatible endpoint leaves thinking out of
 * completion_tokens but counts it in total_tokens, and bills it at the output rate (a reply
 * of 2 tokens reported total 26 with prompt 3). OpenAI already includes reasoning in
 * completion_tokens, so the larger of the two is right for both.
 */
export function billedOutputTokens(u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): number {
  const completion = u.completion_tokens ?? 0;
  const rest = (u.total_tokens ?? 0) - (u.prompt_tokens ?? 0);
  return Math.max(completion, rest);
}

/** Length of a PCM WAV from its header; null for other formats (webm, ogg). */
export async function wavSeconds(audio: Blob): Promise<number | null> {
  if (audio.size < 44) return null;
  const head = new DataView(await audio.slice(0, 44).arrayBuffer());
  if (head.getUint32(0, false) !== 0x52494646 || head.getUint32(8, false) !== 0x57415645) return null; // "RIFF" … "WAVE"
  const byteRate = head.getUint32(28, true);
  return byteRate > 0 ? Math.round(((audio.size - 44) / byteRate) * 100) / 100 : null;
}
