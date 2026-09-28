'use server';
import { sql } from '@/lib/db';
import { requireRole, auditAction } from '@/lib/auth';
import { choice, text } from '@/lib/validation';
import { grantConsent } from '@/modules/candidate';
import { startSession, learnerTurn, endSession } from '@/modules/simulation';
import { sarvamConfigured, sarvamSpeechToText, sarvamTextToSpeech, SARVAM_LANGUAGES, type SarvamLanguage } from '@/modules/adapters/sarvam';

/**
 * Sales practice. Every call re-checks that the session belongs to the signed-in
 * candidate (inside the simulation module); nothing from the client names a
 * candidate. Errors come back as values so the learner sees the real reason.
 */

async function candidate() { return requireRole(['CANDIDATE']); }
const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });

/** Without Sarvam there is no translator, so the rule-based customer covers only English, Hindi and Marathi. */
export async function practiceLanguages(): Promise<readonly string[]> {
  return sarvamConfigured() ? SARVAM_LANGUAGES : ['en', 'hi', 'mr'];
}

export async function beginPractice(scenarioId: string, language: string, retryOf?: string) {
  try {
    const c = await candidate();
    const lang = choice(language, await practiceLanguages(), 'language') as SarvamLanguage;
    const { sessionId } = await startSession(c.id, text(scenarioId, 'Scenario', 60), lang, retryOf || null);
    await auditAction('SIMULATION_STARTED', [sessionId]);
    return { sessionId };
  } catch (e) { return fail(e); }
}

export async function sendLine(sessionId: string, line: string, mode: 'TEXT' | 'VOICE', sttConfidence: number | null) {
  try {
    const c = await candidate();
    const said = text(line, 'Your message', 1000);
    return await learnerTurn(c.id, sessionId, said, choice(mode, ['TEXT', 'VOICE'] as const, 'mode'),
      typeof sttConfidence === 'number' && sttConfidence >= 0 && sttConfidence <= 1 ? sttConfidence : null);
  } catch (e) { return fail(e); }
}

export async function finishPractice(sessionId: string, timedOut = false) {
  try {
    const c = await candidate();
    await endSession(c.id, sessionId, timedOut ? 'TIMED_OUT' : 'COMPLETED');
    await auditAction('SIMULATION_COMPLETED', [sessionId]);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function allowPracticeVoice() {
  try {
    const c = await candidate();
    await grantConsent(c.id, 'SIMULATION_VOICE');
    await auditAction('CONSENT_CHOICES_SAVED', [c.id]);
    return { ok: true };
  } catch (e) { return fail(e); }
}

async function sessionLanguage(candidateId: string, sessionId: string) {
  const [s] = await sql`SELECT language, status FROM app.simulation_session WHERE id=${sessionId} AND candidate_id=${candidateId}`;
  if (!s) throw new Error('Practice session not found.');
  return s.language as SarvamLanguage;
}

/** Speech-to-text through Sarvam. Audio leaves the device, so it needs its own consent. */
export async function transcribe(sessionId: string, form: FormData) {
  try {
    const c = await candidate();
    if (!sarvamConfigured()) throw new Error('Voice transcription is not configured.');
    const [consent] = await sql`SELECT 1 FROM app.consent_record WHERE candidate_id=${c.id} AND purpose='SIMULATION_VOICE' AND granted_at IS NOT NULL AND withdrawn_at IS NULL`;
    if (!consent) throw new Error('Allow voice practice first.');
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || !audio.size) throw new Error('No recording was received.');
    if (audio.size > 3 * 1024 * 1024) throw new Error('That recording is too long. Keep answers under a minute.');
    const lang = await sessionLanguage(c.id, sessionId);
    const { transcript } = await sarvamSpeechToText(audio, lang);
    return { transcript };
  } catch (e) { return fail(e); }
}

/** The customer's reply as speech. Only turns already in the session can be spoken. */
export async function speakTurn(sessionId: string, seq: number) {
  try {
    const c = await candidate();
    if (!sarvamConfigured()) return { audio: null };
    const lang = await sessionLanguage(c.id, sessionId);
    const [turn] = await sql`SELECT text FROM app.simulation_turn WHERE session_id=${sessionId} AND seq=${seq} AND speaker='CUSTOMER'`;
    if (!turn) return { audio: null };
    return { audio: await sarvamTextToSpeech(turn.text, lang) };
  } catch { return { audio: null }; }
}
