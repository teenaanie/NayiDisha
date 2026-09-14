'use server';
import { sql } from '@/lib/db';
import { requireRole, auditAction } from '@/lib/auth';
import { nextId } from '@/lib/ids';
import { now } from '@/lib/clock';
import { choice } from '@/lib/validation';
import {
  voiceInterpreter, interpreterContext, CONFIRM_THRESHOLD,
  type VoiceField, type Language,
} from '@/modules/adapters/voice';

const FIELDS: VoiceField[] = [
  'name', 'locality', 'experienceMonths', 'skills', 'expectedPay', 'commute', 'shifts', 'confirm',
];

/**
 * Turn one spoken answer into one structured field.
 *
 * The transcript arrives as text — the browser does the speech recognition, so
 * no audio is uploaded. Every turn is recorded so Operations can see exactly
 * what the candidate said versus what the system understood, which is what
 * makes a voice-captured profile auditable rather than a black box.
 */
export async function interpretAnswer(field: string, transcript: string, language: string) {
  const c = await requireRole(['CANDIDATE']);
  const f = choice(field, FIELDS, 'field');
  const lang = choice(language, ['en', 'hi', 'mr'] as const, 'language') as Language;
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Nothing was heard. Please try again.');
  if (transcript.length > 2000) throw new Error('That answer was too long.');

  const context = await interpreterContext();
  const result = await voiceInterpreter().interpret(f, transcript.trim(), lang, context);

  await sql`
    INSERT INTO app.voice_turn (id, candidate_id, field, language, transcript, interpreted, confidence, provider, created_at)
    VALUES (${await nextId('VOX')}, ${c.id}, ${f}, ${lang}, ${transcript.trim()},
            ${sql.json({ value: result.value, display: result.display } as never)},
            ${result.confidence}, ${result.provider}, ${await now()})
  `;

  return {
    value: result.value,
    display: result.display,
    confidence: result.confidence,
    /** Below this the journey reads the value back and waits for a yes. */
    needsConfirmation: result.confidence < CONFIRM_THRESHOLD || result.value === null,
    understood: result.value !== null,
  };
}

/** Mark the most recent turn for a field as accepted by the candidate. */
export async function acceptAnswer(field: string) {
  const c = await requireRole(['CANDIDATE']);
  const f = choice(field, FIELDS, 'field');
  await sql`
    UPDATE app.voice_turn SET accepted = TRUE
     WHERE id = (SELECT id FROM app.voice_turn WHERE candidate_id=${c.id} AND field=${f}
                  ORDER BY created_at DESC, id DESC LIMIT 1)
  `;
}

/** What the voice journey collected, for the review card before saving. */
export async function voiceSummary() {
  const c = await requireRole(['CANDIDATE']);
  return sql<{ field: string; transcript: string; interpreted: { value: unknown; display: string }; confidence: string }[]>`
    SELECT DISTINCT ON (field) field, transcript, interpreted, confidence
      FROM app.voice_turn WHERE candidate_id=${c.id}
     ORDER BY field, created_at DESC, id DESC
  `;
}

export async function auditVoiceCompleted() {
  const c = await requireRole(['CANDIDATE']);
  await auditAction('VOICE_PROFILE_CAPTURED', [c.id]);
}
