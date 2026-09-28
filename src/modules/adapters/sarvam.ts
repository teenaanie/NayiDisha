/**
 * Sarvam AI — Indian-language speech, translation and chat.
 *
 * Used by sales practice, where a candidate talks to an AI customer in their
 * own language. Same shape as the other adapters: raw fetch, no SDK, and every
 * call is optional. Without SARVAM_API_KEY the practice still runs: chat falls
 * back to Claude or Gemini (see llm.ts), speech to the browser, and translation
 * to "keep the original", which the evaluator is told about.
 *
 * Endpoints and model ids follow docs.sarvam.ai; each is overridable by env so a
 * model rename is a config change, not a deploy.
 */

const BASE = process.env.SARVAM_API_URL || 'https://api.sarvam.ai';

export type SarvamLanguage = 'en' | 'hi' | 'mr' | 'ta' | 'te' | 'kn' | 'bn' | 'gu' | 'ml' | 'pa' | 'od';
export const SARVAM_LANGUAGES: readonly SarvamLanguage[] = ['en', 'hi', 'mr', 'ta', 'te', 'kn', 'bn', 'gu', 'ml', 'pa', 'od'];
export const LANGUAGE_NAMES: Record<SarvamLanguage, string> = {
  en: 'English', hi: 'हिन्दी', mr: 'मराठी', ta: 'தமிழ்', te: 'తెలుగు', kn: 'ಕನ್ನಡ',
  bn: 'বাংলা', gu: 'ગુજરાતી', ml: 'മലയാളം', pa: 'ਪੰਜਾਬੀ', od: 'ଓଡ଼ିଆ',
};
/** BCP-47 tag Sarvam and the browser speech APIs both accept. */
export const bcp47 = (l: SarvamLanguage) => `${l}-IN`;

export const sarvamConfigured = () => !!process.env.SARVAM_API_KEY;

const headers = () => ({ 'api-subscription-key': process.env.SARVAM_API_KEY ?? '' });

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** Sarvam-M reasons inside <think> tags before answering; only the answer is wanted. */
export const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export async function sarvamChat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL || 'sarvam-m',
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 600,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sarvam chat returned HTTP ${res.status}`);
  const body = await res.json();
  return stripThinking(String(body?.choices?.[0]?.message?.content ?? ''));
}

export async function sarvamTranslate(text: string, from: SarvamLanguage, to: SarvamLanguage): Promise<string> {
  if (from === to || !text.trim()) return text;
  const res = await fetch(`${BASE}/translate`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      input: text.slice(0, 1000),
      source_language_code: bcp47(from),
      target_language_code: bcp47(to),
      model: process.env.SARVAM_TRANSLATE_MODEL || 'mayura:v1',
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Sarvam translate returned HTTP ${res.status}`);
  const body = await res.json();
  return String(body?.translated_text ?? '');
}

export async function sarvamSpeechToText(audio: Blob, language: SarvamLanguage): Promise<{ transcript: string; language: string | null }> {
  const form = new FormData();
  form.append('file', audio, 'answer.webm');
  form.append('model', process.env.SARVAM_STT_MODEL || 'saarika:v2.5');
  form.append('language_code', bcp47(language));
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: 'POST', headers: headers(), body: form, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sarvam speech-to-text returned HTTP ${res.status}`);
  const body = await res.json();
  return { transcript: String(body?.transcript ?? ''), language: body?.language_code ?? null };
}

/** Returns a base64 WAV. The customer is a father, so the default voice is male. */
export async function sarvamTextToSpeech(text: string, language: SarvamLanguage): Promise<string> {
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, 1500),
      target_language_code: bcp47(language),
      speaker: process.env.SARVAM_TTS_SPEAKER || 'abhilash',
      model: process.env.SARVAM_TTS_MODEL || 'bulbul:v2',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sarvam text-to-speech returned HTTP ${res.status}`);
  const body = await res.json();
  const audio = body?.audios?.[0];
  if (typeof audio !== 'string') throw new Error('Sarvam text-to-speech returned no audio');
  return audio;
}
