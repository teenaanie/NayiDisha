'use server';
import { sql } from '@/lib/db';
import { requireRole, auditAction } from '@/lib/auth';
import { choice } from '@/lib/validation';
import { voiceInterpreter, interpreterContext, CONFIRM_THRESHOLD, type Language, type FieldSpec } from '@/modules/adapters/voice';
import {
  scriptForConfig, startRun, activeRun, recordResponse, completeRun,
  type ScriptTurn, type RoleScript,
} from '@/modules/script';

const LANGS = ['en', 'hi', 'mr'] as const;

async function candidate() { return requireRole(['CANDIDATE']); }

async function roleContext(candidateId: string) {
  const [row] = await sql<{ role_config_id: string | null }[]>`
    SELECT role_config_id FROM app.candidate WHERE id = ${candidateId}
  `;
  if (!row?.role_config_id) throw new Error('Choose a role before the role questions.');
  const script = await scriptForConfig(row.role_config_id);
  if (!script) throw new Error('This role has no conversational script.');
  return { roleConfigId: row.role_config_id, script };
}

/** What the runner needs to ask: the drawn turns, in order, for this run. */
export async function beginScript(jobId?: string) {
  const c = await candidate();
  const { script } = await roleContext(c.id);
  const job = typeof jobId === 'string' && /^JOB-[A-Z0-9-]{1,20}$/.test(jobId) ? jobId : null;
  const { runId, turns } = await startRun(c.id, script, job);
  await auditAction('SCRIPT_RUN_STARTED', [c.id, runId]);
  return {
    runId,
    scriptId: script.id,
    steps: turns.map((t) => ({ key: t.key, ask: t.ask })),
  };
}

/** Resolve a turn key against the run that is actually open — never trust the client. */
async function turnFor(candidateId: string, script: RoleScript, turnKey: string): Promise<{ runId: string; turn: ScriptTurn }> {
  const run = await activeRun(candidateId, script.id);
  if (!run) throw new Error('Start the role questions again.');
  if (!run.turn_keys.includes(turnKey)) throw new Error('That question is not part of this run.');
  const turn = script.turns.find((t) => t.key === turnKey);
  if (!turn) throw new Error('That question is not part of this script.');
  return { runId: run.id, turn };
}

/**
 * Interpret one spoken answer.
 *
 * A SKILL answer is an opinion, not a value to normalise, so it is taken
 * verbatim and read back for confirmation rather than sent to the interpreter.
 * Only ATTRIBUTE answers are interpreted into a structured value.
 */
export async function interpretScriptAnswer(turnKey: string, transcript: string, language: string) {
  const c = await candidate();
  const lang = choice(language, LANGS, 'language') as Language;
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Nothing was heard. Please try again.');
  if (transcript.length > 4000) throw new Error('That answer was too long.');
  const { script } = await roleContext(c.id);
  const { turn } = await turnFor(c.id, script, turnKey);

  if (turn.kind === 'SKILL') {
    return { value: transcript.trim(), display: transcript.trim(), confidence: 1, needsConfirmation: false, understood: true };
  }

  const spec: FieldSpec = {
    key: turn.attributeKey, dataType: turn.dataType,
    expected: turn.expected, allowedValues: turn.allowedValues,
  };
  const base = await interpreterContext();
  const r = await voiceInterpreter().interpret(turn.key, transcript.trim(), lang, { ...base, spec });
  return {
    value: r.value, display: r.display, confidence: r.confidence,
    needsConfirmation: r.confidence < CONFIRM_THRESHOLD || r.value === null,
    understood: r.value !== null,
  };
}

/** Persist an accepted answer: the attribute write-through, or the rubric score. */
export async function acceptScriptAnswer(turnKey: string, transcript: string, language: string, value?: unknown, display?: string) {
  const c = await candidate();
  const lang = choice(language, LANGS, 'language') as Language;
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Nothing to save.');
  const { script, roleConfigId } = await roleContext(c.id);
  const { runId, turn } = await turnFor(c.id, script, turnKey);
  await recordResponse({
    runId, candidateId: c.id, turn, roleConfigId,
    transcript: transcript.trim(), language: lang,
    interpreted: turn.kind === 'ATTRIBUTE' ? { value: value ?? null, display: String(display ?? '') } : undefined,
  });
}

export async function finishScript() {
  const c = await candidate();
  const { script } = await roleContext(c.id);
  const run = await activeRun(c.id, script.id);
  if (!run) throw new Error('There is no run to finish.');
  const result = await completeRun(run.id);
  await auditAction('SCRIPT_RUN_COMPLETED', [c.id, run.id]);
  const { safelyRefreshCandidate } = await import('@/modules/discovery');
  await safelyRefreshCandidate(c.id).catch(() => {});
  return { ...result, passThreshold: script.passThreshold, passed: result.score >= script.passThreshold };
}
