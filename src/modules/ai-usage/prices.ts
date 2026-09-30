/**
 * Price list for the token meter.
 *
 * List prices, not what a free tier actually charges: Gemini's free allowance
 * bills nothing, so read the Gemini figures as "what this would cost on a paid
 * key". A model missing from this list is still counted, just shown as
 * "no price" on /ops/ai-usage rather than guessed.
 *
 * Sarvam is deliberately absent: its prices are in rupees and change with each
 * model generation, so set them from dashboard.sarvam.ai with AI_PRICES, e.g.
 *   AI_PRICES='{"sarvam-105b-conversations":{"currency":"INR","input":0,"output":0},
 *               "saaras:v3":{"currency":"INR","perAudioHour":30},
 *               "bulbul:v3":{"currency":"INR","perMillionChars":1500},
 *               "mayura:v1":{"currency":"INR","perMillionChars":2000}}'
 * Entries in AI_PRICES replace the defaults below, model by model.
 */
export interface Price {
  currency?: 'USD' | 'INR';
  /** Per million tokens. */
  input?: number;
  output?: number;
  /** Per million cache-read tokens; defaults to 10% of input. */
  cachedInput?: number;
  perMillionChars?: number;
  perAudioHour?: number;
}

// Claude: Anthropic first-party API rates, checked 30 Sep 2026.
// Gemini: Google AI paid-tier rates for text, checked 30 Sep 2026.
const DEFAULTS: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
};

/** Rupees per dollar, for showing costs in ₹ and converting rupee prices. */
export const USD_INR = Number(process.env.AI_USD_INR) || 88;

let merged: Record<string, Price> | null = null;
export function priceList(): Record<string, Price> {
  if (merged) return merged;
  let overrides: Record<string, Price> = {};
  try { overrides = JSON.parse(process.env.AI_PRICES || '{}'); } catch { console.warn('AI_PRICES is not valid JSON; using default prices'); }
  return (merged = { ...DEFAULTS, ...overrides });
}

export interface Metered { input_tokens: number; cached_tokens: number; output_tokens: number; characters: number; audio_seconds: number }

/** Cost in US dollars, or null when the model has no price. */
export function costUsd(model: string, m: Metered): number | null {
  const p = priceList()[model];
  if (!p) return null;
  const native =
    (m.input_tokens * (p.input ?? 0) + m.cached_tokens * (p.cachedInput ?? (p.input ?? 0) / 10) + m.output_tokens * (p.output ?? 0)) / 1e6 +
    (m.characters * (p.perMillionChars ?? 0)) / 1e6 +
    (m.audio_seconds * (p.perAudioHour ?? 0)) / 3600;
  return p.currency === 'INR' ? native / USD_INR : native;
}
