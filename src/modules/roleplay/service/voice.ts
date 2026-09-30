import { sql } from '@/lib/db';
import { sarvamConfigured, sarvamSpeechToText, SARVAM_STT_MODEL, sarvamTextToSpeech, SARVAM_LANGUAGES, type SarvamLanguage } from '@/modules/adapters/sarvam';
import { ApiError, audit, forbidden, logError, metric, notFound, type Actor } from './context';
import { rateLimit } from './guards';
import { loadSessionFor, loadBundle } from './sessions';
import { bcp47 } from '../runtime/language';

/**
 * Voice practice (spec §3, §16).
 *
 * Speech never bypasses the text contract. The learner speaks, reads the
 * transcript, corrects it if needed, and sends it like any typed message; the
 * committed text is what gets assessed. Provenance (recogniser, raw
 * transcript, whether it was corrected) is kept beside the turn.
 *
 * Recognition and read-aloud run in the browser by default (Web Speech API;
 * the browser vendor's service does the recognition). With SARVAM_API_KEY set,
 * they run on the server through Sarvam, which handles Indian accents and
 * languages better. Audio is never stored in either mode.
 */

export const VOICE_NOTICE_VERSION = 'voice-notice-1.0';
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export interface VoiceCapabilities {
  recognition: 'server' | 'browser';
  speech: 'server' | 'browser';
  server_provider: 'sarvam' | null;
  language: string;          // BCP-47, from the scenario locale
  notice: string;
}

function noticeFor(server: boolean) {
  return server
    ? 'When you use the microphone, your recording is sent to Sarvam AI to be turned into text. It is not stored. You check and correct the text before it is sent.'
    : 'When you use the microphone, your browser turns speech into text using its own speech service (for Chrome and Edge, that is Google or Microsoft). Nothing is recorded by NayiDisha. You check and correct the text before it is sent.';
}

export function voiceCapabilities(locale: string): VoiceCapabilities {
  const server = sarvamConfigured();
  return { recognition: server ? 'server' : 'browser', speech: server ? 'server' : 'browser', server_provider: server ? 'sarvam' : null, language: locale || 'en-IN', notice: noticeFor(server) };
}

// ---- consent ------------------------------------------------------------------

export async function hasVoiceConsent(actor: Actor): Promise<boolean> {
  const [c] = await sql`SELECT 1 FROM rp.voice_consent WHERE user_id = ${actor.user_id} AND tenant_id = ${actor.tenant_id} AND granted_at IS NOT NULL AND withdrawn_at IS NULL`;
  return !!c;
}

export async function setVoiceConsent(actor: Actor, granted: boolean) {
  await sql`
    INSERT INTO rp.voice_consent (user_id, tenant_id, notice_version, granted_at, withdrawn_at)
    VALUES (${actor.user_id}, ${actor.tenant_id}, ${VOICE_NOTICE_VERSION}, ${granted ? new Date() : null}, ${granted ? null : new Date()})
    ON CONFLICT (user_id) DO UPDATE SET notice_version = EXCLUDED.notice_version,
      granted_at = CASE WHEN ${granted} THEN now() ELSE rp.voice_consent.granted_at END,
      withdrawn_at = CASE WHEN ${granted} THEN NULL ELSE now() END`;
  await audit(actor, granted ? 'voice.consent_granted' : 'voice.consent_withdrawn', 'app_user', actor.user_id, { notice_version: VOICE_NOTICE_VERSION });
  return { granted, notice_version: VOICE_NOTICE_VERSION };
}

// ---- provenance for a spoken turn ------------------------------------------------

export interface VoiceInput { mode: 'voice'; asr_provider: string; asr_text: string; asr_confidence: number | null }

/** Validate the client's description of how a turn was spoken; nothing here is trusted as content. */
export function parseVoiceInput(raw: unknown): VoiceInput | null {
  if (raw === undefined || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== 'voice') throw new ApiError(400, 'BAD_INPUT_MODE', 'input.mode must be "voice".');
  if (typeof r.asr_provider !== 'string' || !/^(browser|sarvam):[a-z0-9_.-]{1,30}$/.test(r.asr_provider)) throw new ApiError(400, 'BAD_ASR_PROVIDER', 'input.asr_provider is not a recognised speech engine.');
  if (typeof r.asr_text !== 'string' || !r.asr_text.trim() || r.asr_text.length > 4000) throw new ApiError(400, 'BAD_ASR_TEXT', 'input.asr_text must be the transcript as heard (1–4000 characters).');
  const conf = r.asr_confidence;
  if (conf !== null && conf !== undefined && (typeof conf !== 'number' || !(conf >= 0 && conf <= 1))) throw new ApiError(400, 'BAD_ASR_CONFIDENCE', 'input.asr_confidence must be between 0 and 1.');
  return { mode: 'voice', asr_provider: r.asr_provider, asr_text: r.asr_text, asr_confidence: typeof conf === 'number' ? conf : null };
}

// ---- server recognition and speech (Sarvam) --------------------------------------

function sarvamLanguage(locale: string): SarvamLanguage {
  const code = (locale || 'en-IN').slice(0, 2).toLowerCase() as SarvamLanguage;
  return SARVAM_LANGUAGES.includes(code) ? code : 'en';
}

async function activeOwnSession(actor: Actor, sessionId: string) {
  const s = await loadSessionFor(actor, sessionId);
  if (s.state !== 'active') throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'This practice has ended.');
  return s;
}

export async function transcribe(actor: Actor, sessionId: string, audio: Blob) {
  const s = await activeOwnSession(actor, sessionId);
  if (!sarvamConfigured()) throw new ApiError(503, 'VOICE_UNAVAILABLE', 'Server speech recognition is not configured; the browser recogniser is used instead.');
  if (!(await hasVoiceConsent(actor))) throw forbidden('Allow voice practice before using the microphone.');
  if (!audio.size) throw new ApiError(400, 'NO_AUDIO', 'No recording was received.');
  if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(422, 'AUDIO_TOO_LONG', 'That recording is too long. Keep each answer under about a minute.');
  await rateLimit(actor, 'turn');
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  const started = Date.now();
  try {
    const { transcript } = await sarvamSpeechToText(audio, sarvamLanguage(bcp47(s.language ?? 'en')), 'roleplay.transcribe');
    await metric('voice_transcribed_ms', Date.now() - started, { provider: 'sarvam' }, actor.tenant_id);
    // The audio buffer goes out of scope here; nothing is written anywhere.
    return { transcript, asr_provider: `sarvam:${SARVAM_STT_MODEL.replace(/[^a-z0-9_.-]/g, '_')}`, asr_confidence: null, language: bcp47(s.language ?? 'en') };
  } catch (e) {
    logError('voice.transcribe', e, { tenant_id: actor.tenant_id, session_id: sessionId });
    await metric('voice_transcribe_failed', 1, { provider: 'sarvam' }, actor.tenant_id);
    throw new ApiError(502, 'TRANSCRIPTION_FAILED', 'We could not turn that recording into text. Try again, or type instead.', true);
  }
}

/** Read a committed customer turn aloud. Only text the customer actually said can be spoken. */
export async function speak(actor: Actor, sessionId: string, turnId: string) {
  const s = await loadSessionFor(actor, sessionId);
  if (!sarvamConfigured()) throw new ApiError(503, 'VOICE_UNAVAILABLE', 'Server speech is not configured; the browser voice is used instead.');
  if (!/^[0-9a-f-]{36}$/i.test(turnId)) throw notFound('Turn');
  const [t] = await sql<{ text: string }[]>`SELECT text FROM rp.turn WHERE id = ${turnId} AND session_id = ${s.id} AND speaker = 'customer'`;
  if (!t) throw notFound('Turn');
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  try {
    const audio = await sarvamTextToSpeech(t.text, sarvamLanguage(bcp47(s.language ?? 'en')), 'roleplay.read_aloud');
    return { audio_base64: audio, format: 'wav' };
  } catch (e) {
    logError('voice.speak', e, { tenant_id: actor.tenant_id, session_id: sessionId });
    throw new ApiError(502, 'SPEECH_FAILED', 'The reply could not be read aloud.', true);
  }
}
