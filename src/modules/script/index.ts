import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { skillScorer, needsReview, type SkillTurn, type SkillScore } from '@/modules/adapters/scoring';
import type { FieldSpec, Language } from '@/modules/adapters/voice';

/**
 * Role scripts — the conversational, role-specific half of onboarding.
 *
 * The common intake (name, locality, pay, commute…) is the same for everyone
 * and already exists. This module handles what differs by role: the structured
 * attributes a configuration declares, and open skill questions scored against
 * a rubric.
 *
 * Scores are reproducible after the fact. A run records which bank questions it
 * drew, and every response keeps the transcript, the rubric version, the scorer
 * and its reasoning.
 */

export interface AttributeTurn {
  key: string;
  kind: 'ATTRIBUTE';
  attributeKey: string;
  dataType: FieldSpec['dataType'];
  required: boolean;
  allowedValues?: string[];
  expected: string;
  ask: Record<Language, string>;
}

export type ScriptTurn = AttributeTurn | (SkillTurn & { kind: 'SKILL' });

export interface RoleScript {
  id: string;
  roleConfigId: string;
  version: string;
  askCount: number;
  passThreshold: number;
  turns: ScriptTurn[];
}

interface ScriptRow {
  id: string; role_config_id: string; version: string;
  ask_count: number; pass_threshold: number; turns: ScriptTurn[];
}

const hydrate = (r: ScriptRow): RoleScript => ({
  id: r.id, roleConfigId: r.role_config_id, version: r.version,
  askCount: r.ask_count, passThreshold: r.pass_threshold, turns: r.turns,
});

/** The published script for a role configuration, or null if it has none. */
export async function scriptForConfig(roleConfigId: string): Promise<RoleScript | null> {
  const [row] = await sql<ScriptRow[]>`
    SELECT s.* FROM app.role_script s
      JOIN app.role_configuration c ON c.role_script_id = s.id
     WHERE c.id = ${roleConfigId} AND s.status = 'PUBLISHED'
  `;
  return row ? hydrate(row) : null;
}

export async function scriptById(id: string): Promise<RoleScript | null> {
  const [row] = await sql<ScriptRow[]>`SELECT * FROM app.role_script WHERE id = ${id}`;
  return row ? hydrate(row) : null;
}

/** Deterministic only in shape: every attribute turn, then askCount skill turns. */
function drawTurns(script: RoleScript): ScriptTurn[] {
  const attributes = script.turns.filter((t): t is AttributeTurn => t.kind === 'ATTRIBUTE');
  const skills = script.turns.filter((t) => t.kind === 'SKILL');
  const shuffled = [...skills];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[k]] = [shuffled[k], shuffled[i]];
  }
  return [...attributes, ...shuffled.slice(0, script.askCount)];
}

/**
 * Open a run. Any earlier in-progress run for the same script is abandoned
 * rather than resumed — a half-finished conversation is not worth restoring,
 * and leaving it IN_PROGRESS would make the latest-score lookup ambiguous.
 */
export async function startRun(candidateId: string, script: RoleScript, jobId: string | null) {
  const at = await now();
  await sql`
    UPDATE app.script_run SET status='ABANDONED', completed_at=${at}
     WHERE candidate_id=${candidateId} AND script_id=${script.id} AND status='IN_PROGRESS'
  `;
  const drawn = drawTurns(script);
  const id = await nextId('SRN');
  await sql`
    INSERT INTO app.script_run (id, candidate_id, script_id, script_version, job_id, turn_keys, status, started_at)
    VALUES (${id}, ${candidateId}, ${script.id}, ${script.version}, ${jobId},
            ${sql.json(drawn.map((t) => t.key) as never)}, 'IN_PROGRESS', ${at})
  `;
  return { runId: id, turns: drawn };
}

export async function activeRun(candidateId: string, scriptId: string) {
  const [row] = await sql<{ id: string; turn_keys: string[] }[]>`
    SELECT id, turn_keys FROM app.script_run
     WHERE candidate_id=${candidateId} AND script_id=${scriptId} AND status='IN_PROGRESS'
     ORDER BY started_at DESC LIMIT 1
  `;
  return row ?? null;
}

/**
 * Record one answer.
 *
 * An ATTRIBUTE answer also writes through to candidate_attribute_value, which
 * is what the matching engine's Stage B actually reads — the same upsert the
 * typed profile form uses. A SKILL answer is scored against its rubric here.
 */
export async function recordResponse(opts: {
  runId: string; candidateId: string; turn: ScriptTurn; roleConfigId: string;
  transcript: string; language: Language; interpreted?: { value: unknown; display: string };
}): Promise<{ id: string; score: SkillScore | null }> {
  const at = await now();
  const id = await nextId('SRP');

  if (opts.turn.kind === 'ATTRIBUTE') {
    const value = opts.interpreted?.value;
    if (value !== null && value !== undefined) {
      const isBool = opts.turn.dataType === 'BOOL';
      const isInt = opts.turn.dataType === 'INT' || opts.turn.dataType === 'MONEY_PAISE';
      await sql`
        INSERT INTO app.candidate_attribute_value
          (id, candidate_id, attribute_key, role_config_id, value_text, value_bool, value_int, collected_at)
        VALUES (${await nextId('ATV')}, ${opts.candidateId}, ${opts.turn.attributeKey}, ${opts.roleConfigId},
                ${isBool || isInt ? null : String(value)},
                ${isBool ? Boolean(value) : null},
                ${isInt ? Number(value) : null}, ${at})
        ON CONFLICT (candidate_id, attribute_key) DO UPDATE SET
          role_config_id=EXCLUDED.role_config_id, value_text=EXCLUDED.value_text,
          value_bool=EXCLUDED.value_bool, value_int=EXCLUDED.value_int,
          collected_at=EXCLUDED.collected_at
      `;
    }
    await sql`
      INSERT INTO app.script_response
        (id, run_id, candidate_id, turn_key, kind, language, transcript, interpreted, confidence, accepted, created_at)
      VALUES (${id}, ${opts.runId}, ${opts.candidateId}, ${opts.turn.key}, 'ATTRIBUTE', ${opts.language},
              ${opts.transcript}, ${sql.json((opts.interpreted ?? null) as never)}, 0, TRUE, ${at})
    `;
    return { id, score: null };
  }

  const scored = await skillScorer().score(opts.turn, opts.transcript, opts.language);
  await sql`
    INSERT INTO app.script_response
      (id, run_id, candidate_id, turn_key, kind, language, transcript, score, max_score,
       rubric_version, scorer, reasoning, credits, confidence, needs_review, accepted, created_at)
    VALUES (${id}, ${opts.runId}, ${opts.candidateId}, ${opts.turn.key}, 'SKILL', ${opts.language},
            ${opts.transcript}, ${scored.score}, ${scored.maxScore},
            ${opts.turn.rubricVersion}, ${scored.scorer}, ${scored.reasoning},
            ${sql.json(scored.credits as never)}, ${scored.confidence},
            ${needsReview(scored)}, TRUE, ${at})
  `;
  return { id, score: scored };
}

/**
 * Close the run and compute its score as a percentage of the skill marks
 * available, so it lands on the same 0–100 scale as an assessment attempt.
 */
export async function completeRun(runId: string) {
  const at = await now();
  const rows = await sql<{ score: number; max_score: number }[]>`
    SELECT score, max_score FROM app.script_response
     WHERE run_id=${runId} AND kind='SKILL' AND score IS NOT NULL
  `;
  const earned = rows.reduce((a, r) => a + r.score, 0);
  const total = rows.reduce((a, r) => a + r.max_score, 0);
  const pct = total === 0 ? 0 : Math.round((earned / total) * 100);
  await sql`
    UPDATE app.script_run SET status='COMPLETED', score=${pct}, max_score=100, completed_at=${at}
     WHERE id=${runId}
  `;
  return { score: pct, earned, total };
}

/** Latest completed score for a candidate on a script, for Stage B and Stage C. */
export async function latestScore(candidateId: string, scriptId: string) {
  const [row] = await sql<{ score: number; script_version: string }[]>`
    SELECT score, script_version FROM app.script_run
     WHERE candidate_id=${candidateId} AND script_id=${scriptId}
       AND status='COMPLETED' AND score IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1
  `;
  return row ?? null;
}

/** Everything operations needs to audit a run: what was said, and how it scored. */
export async function runDetail(candidateId: string) {
  return sql`
    SELECT r.id AS run_id, r.script_id, r.script_version, r.job_id, r.score, r.status, r.completed_at,
           p.turn_key, p.kind, p.transcript, p.interpreted, p.score AS turn_score, p.max_score,
           p.rubric_version, p.scorer, p.reasoning, p.credits, p.confidence, p.needs_review
      FROM app.script_run r
      LEFT JOIN app.script_response p ON p.run_id = r.id
     WHERE r.candidate_id = ${candidateId}
     ORDER BY r.started_at DESC, p.created_at
  `;
}
