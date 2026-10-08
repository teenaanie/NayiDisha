import { sql } from '@/lib/db';
import { ApiError, actorFor, audit, logError, notFound, requireRole, type Actor } from './context';
import { startSession, getSession, submitTurn, finishSession } from './sessions';
import { getReport } from './evaluation';
import { drain } from './jobs';
import { startTrainingRun } from './training';
import { loadPrompt } from '../config/content';
import { completeWithRetry } from '../providers';
import { SIM_LEVELS, simLevel, simSubject, SIM_RUNNER_SUBJECT, type SimLevel } from '../simulation/levels';

/**
 * Simulated candidates (operator menu → Simulated candidates).
 *
 * AI candidates at three levels practise with the AI customer through the real product, as
 * synthetic learners in their own team: each session is started, spoken, finished, assessed and
 * coached by the same functions the app uses. Before each new practice a candidate reads the
 * coaching from its previous report and applies it as its level would. After the practices it
 * takes the graded assessment. A run then checks each level's score against its expected band
 * and hands the sessions to the AI training agent.
 *
 * Work moves in small steps (one candidate message and the customer's reply, or a finish and its
 * assessment) under a lease, levels in parallel, driven by the run page and the daily cron.
 */

export const CANDIDATE_PROMPT = 'candidate_v1';
const LEASE_SECONDS = 290;
const SCENARIO_ID = 'EDU_DISCOVERY_001';

export interface SimConfig {
  levels: SimLevel['id'][];
  practice_sessions: number;
  assessment: boolean;
  learn: boolean;
  language: 'en' | 'hi' | 'mr';
  message_budget: number;
  train_after: boolean;
}
export const DEFAULT_SIM_CONFIG: SimConfig = { levels: ['needs_improvement', 'competent', 'excellent'], practice_sessions: 5, assessment: true, learn: true, language: 'en', message_budget: 14, train_after: true };

interface RunRow { id: string; tenant_id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; config: SimConfig; scenario_id: string; summary: Calibration[] | null; training_run_id: string | null; error: string | null; created_by: string; created_at: Date; completed_at: Date | null }
export interface SimSessionRow { id: string; run_id: string; level: string; seq: number; kind: 'practice' | 'assessment'; status: 'pending' | 'talking' | 'scoring' | 'done' | 'failed'; session_id: string | null; messages: number; closing: boolean; final_percent: string | null; band_label: string | null; coach_notes: string[] | null; error: string | null; updated_at: Date }
export interface Calibration { level: string; label: string; expected: string; practice: (number | null)[]; assessment: { percent: number | null; band: string | null } | null; judged_on: 'assessment' | 'last practice' | null; in_band: boolean | null }

const candidateSchema = { type: 'object', additionalProperties: false, required: ['message', 'done'], properties: { message: { type: 'string' }, done: { type: 'boolean' } } } as const;

function canRun(actor: Actor) { requireRole(actor, 'author', 'tenant_admin'); }

export function parseSimConfig(input: Partial<SimConfig> | undefined): SimConfig {
  const c = { ...DEFAULT_SIM_CONFIG, ...(input ?? {}) };
  const levels = Array.from(new Set((c.levels ?? []).filter((l) => simLevel(l))));
  if (!levels.length) throw new ApiError(400, 'NO_LEVELS', 'Choose at least one candidate level.');
  const n = (v: unknown, lo: number, hi: number, name: string) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) throw new ApiError(400, 'BAD_CONFIG', `${name} must be a whole number from ${lo} to ${hi}.`); return x; };
  if (!['en', 'hi', 'mr'].includes(c.language)) throw new ApiError(400, 'BAD_CONFIG', 'Language must be English, Hindi or Marathi.');
  return { levels: levels as SimConfig['levels'], practice_sessions: n(c.practice_sessions, 1, 10, 'Practice sessions'), assessment: !!c.assessment, learn: !!c.learn, language: c.language, message_budget: n(c.message_budget, 4, 30, 'Messages per session'), train_after: !!c.train_after };
}

export async function startSimRun(actor: Actor | null, tenantId: string, input?: Partial<SimConfig>, createdBy?: string) {
  if (actor) canRun(actor);
  const config = parseSimConfig(input);
  for (const l of config.levels) if (!(await actorFor(tenantId, simSubject(l)))) throw new ApiError(409, 'SIM_NOT_SEEDED', 'The simulated candidate accounts are missing. Run the roleplay seed first.');
  const [busy] = await sql`SELECT 1 FROM rp.sim_run WHERE tenant_id = ${tenantId} AND status = 'running'`;
  if (busy) throw new ApiError(409, 'SIM_RUN_ACTIVE', 'A simulation is still running. Wait for it to finish or cancel it.');
  return sql.begin(async (tx) => {
    const [run] = await tx<{ id: string }[]>`INSERT INTO rp.sim_run (tenant_id, status, config, scenario_id, created_by)
      VALUES (${tenantId}, 'running', ${tx.json(config as never)}, ${SCENARIO_ID}, ${createdBy ?? actor?.display_name ?? 'system'}) RETURNING id`;
    for (const level of config.levels) {
      for (let i = 1; i <= config.practice_sessions; i++) await tx`INSERT INTO rp.sim_session (tenant_id, run_id, level, seq, kind) VALUES (${tenantId}, ${run.id}, ${level}, ${i}, 'practice')`;
      if (config.assessment) await tx`INSERT INTO rp.sim_session (tenant_id, run_id, level, seq, kind) VALUES (${tenantId}, ${run.id}, ${level}, ${config.practice_sessions + 1}, 'assessment')`;
    }
    await audit(actor, 'simulation.run_started', 'sim_run', run.id, { config }, {}, tx as never);
    return { id: run.id };
  });
}

// ---- one candidate, one step --------------------------------------------------------------

const scoreOf = (body: Record<string, any>) => {
  if (body.kind === 'assessment') return { percent: body.assessment?.final_percent ?? null, band: body.assessment?.band_label ?? null };
  const s = body.report?.score ?? null;
  return { percent: s?.final_percent ?? null, band: s?.band_label ?? null };
};

/** What the candidate's coach told it last time: tips per skill, areas of improvement, missed questions. */
function coachNotes(body: Record<string, any>): string[] {
  const out: string[] = [];
  for (const d of body.dimensions ?? []) if (d.coaching) out.push(`${d.name}: ${d.coaching}`);
  for (const f of body.report?.improvement_areas ?? []) out.push(f.text);
  for (const f of body.report?.missed_questions ?? []) out.push(f.suggested_question ? `Ask: ${f.suggested_question}` : f.text);
  return Array.from(new Set(out)).slice(0, 10);
}

async function setRow(id: string, patch: Partial<Pick<SimSessionRow, 'status' | 'session_id' | 'messages' | 'closing' | 'final_percent' | 'band_label' | 'coach_notes' | 'error'>>) {
  const p = patch as Record<string, string | number | null | undefined | string[]>;
  const v = (x: unknown) => (x === undefined ? null : (x as string | number | null));
  await sql`UPDATE rp.sim_session SET
      status = COALESCE(${v(p.status)}, status), session_id = COALESCE(${v(p.session_id)}::uuid, session_id),
      messages = COALESCE(${v(p.messages)}::int, messages), closing = COALESCE(${'closing' in p ? !!p.closing : null}::boolean, closing), final_percent = COALESCE(${v(p.final_percent)}::numeric, final_percent),
      band_label = COALESCE(${v(p.band_label)}, band_label), error = COALESCE(${v(p.error)}, error),
      coach_notes = ${'coach_notes' in p ? sql.json((p.coach_notes ?? []) as never) : sql`coach_notes`}, updated_at = now()
    WHERE id = ${id}`;
}

/** The runner's own retake for the graded assessment, so every run can end with one (audited). */
async function ensureAttempt(tenantId: string, candidate: Actor) {
  const [u] = await sql<{ used: number; allowed: number }[]>`
    SELECT (SELECT count(*)::int FROM rp.session WHERE tenant_id = ${tenantId} AND learner_id = ${candidate.user_id} AND scenario_id = ${SCENARIO_ID} AND kind = 'assessment') AS used,
           1 + (SELECT count(*)::int FROM rp.assessment_grant WHERE tenant_id = ${tenantId} AND learner_id = ${candidate.user_id} AND scenario_id = ${SCENARIO_ID}) AS allowed`;
  if (u.used < u.allowed) return;
  const runner = await actorFor(tenantId, SIM_RUNNER_SUBJECT);
  if (!runner) throw new ApiError(409, 'SIM_NOT_SEEDED', 'The simulation runner account is missing. Run the roleplay seed first.');
  await sql`INSERT INTO rp.assessment_grant (tenant_id, learner_id, scenario_id, granted_by, reason) VALUES (${tenantId}, ${candidate.user_id}, ${SCENARIO_ID}, ${runner.user_id}, 'Simulated candidate run')`;
  await audit(runner, 'assessment.retake_granted', 'app_user', candidate.user_id, { scenario_id: SCENARIO_ID, reason: 'simulation' });
}

/** Advance one level's current session by one step. Returns false when the level has nothing left to do. */
async function stepLevel(run: RunRow, level: SimLevel): Promise<boolean> {
  const rows = await sql<SimSessionRow[]>`SELECT * FROM rp.sim_session WHERE run_id = ${run.id} AND level = ${level.id} ORDER BY seq`;
  const row = rows.find((r) => r.status !== 'done' && r.status !== 'failed');
  if (!row) return false;
  const candidate = await actorFor(run.tenant_id, simSubject(level.id));
  if (!candidate) throw new ApiError(409, 'SIM_NOT_SEEDED', 'The simulated candidate accounts are missing.');
  try {
    if (row.status === 'pending') {
      // Before a new session: the coaching from the previous one (practice only feeds practice and the assessment).
      const prev = [...rows].reverse().find((r) => r.seq < row.seq && r.status === 'done' && r.session_id && r.kind === 'practice');
      let notes: string[] = [];
      if (run.config.learn && prev?.session_id) {
        const rep = await getReport(candidate, prev.session_id);
        if (rep.status === 200) notes = coachNotes(rep.body as Record<string, any>);
      }
      if (row.kind === 'assessment') await ensureAttempt(run.tenant_id, candidate);
      const started = await startSession(candidate, { scenario_id: run.scenario_id, language: run.config.language === 'en' ? undefined : run.config.language, ...(row.kind === 'assessment' ? { kind: 'assessment' as const } : {}) });
      await setRow(row.id, { status: 'talking', session_id: started.session.session_id, coach_notes: notes as never });
      return true;
    }
    if (row.status === 'talking') {
      const s = await getSession(candidate, row.session_id!);
      if (s.state === 'abandoned') { await setRow(row.id, { status: 'failed', error: 'The session was abandoned.' }); return true; }
      if (s.state !== 'active') { await setRow(row.id, { status: 'scoring' }); return true; }
      if (s.pending_operation) { await drain({ kinds: ['customer_turn'], budgetMs: 30000 }); return true; }
      // Closed (or out of messages): finish. Kept on the row, so a retry finishes rather than talks on.
      if (row.closing || row.messages >= run.config.message_budget) {
        await finishSession(candidate, row.session_id!, { expected_revision: s.revision });
        await setRow(row.id, { status: 'scoring' });
        return true;
      }
      const history = s.transcript.map((t) => ({ speaker: t.speaker === 'learner' ? 'you (the officer)' : 'customer', text: t.text }));
      // A reply cut off mid-JSON (live, 8 Oct 2026) is asked for again rather than failing the session.
      let out: { message: string; done: boolean } | null = null;
      for (let attempt = 0; attempt < 3 && !out; attempt++) {
        const res = await completeWithRetry({
          task: 'simulate', template: loadPrompt(CANDIDATE_PROMPT), schema: candidateSchema as never, temperature: 0.7, maxTokens: 900,
          data: {
            level_json: { id: level.id, label: level.label, behaviour: level.behaviour, use_feedback: level.use_feedback },
            brief_json: { role: 'Loan Sales Officer', brief: s.learner_brief },
            coach_notes_json: row.coach_notes ?? [], message_budget_json: run.config.message_budget, messages_sent_json: row.messages, history_json: history,
          },
          correlation: { tenant_id: run.tenant_id, session_id: row.session_id!, operation_id: `sim:${run.id}` },
        }, undefined, 2);
        try { out = JSON.parse(res.text) as { message: string; done: boolean }; } catch { if (attempt === 2) throw new Error('The candidate\'s reply could not be read after 3 tries.'); }
      }
      const message = cleanMessage(out!.message ?? '') || 'Could you tell me a little more about that?';
      await submitTurn(candidate, row.session_id!, { client_message_id: `sim-${row.id}-${row.messages + 1}`, text: message, expected_revision: s.revision });
      await drain({ kinds: ['customer_turn'], budgetMs: 30000 });
      // The next step finishes once the customer has replied to the closing message.
      await setRow(row.id, { messages: row.messages + 1, closing: out!.done || row.messages + 1 >= run.config.message_budget });
      return true;
    }
    if (row.status === 'scoring') {
      await drain({ kinds: ['evaluate', 'coach', 'project_analytics'], budgetMs: 120000 });
      const rep = await getReport(candidate, row.session_id!);
      if (rep.status === 202) return true;
      const body = rep.body as Record<string, any>;
      if (body.state === 'evaluation_failed') { await setRow(row.id, { status: 'failed', error: 'The assessment failed for this session.' }); return true; }
      const sc = scoreOf(body);
      await setRow(row.id, { status: 'done', final_percent: sc.percent as never, band_label: sc.band });
      return true;
    }
  } catch (e) {
    const err = e as ApiError;
    // Rate limited, or the session moved on in the meantime (a reply landed): try again on the
    // next step. Anything else fails this session only.
    if (err?.status === 429 || (err?.status === 409 && ['STALE_REVISION', 'RESPONSE_PENDING'].includes(err.code))) return true;
    logError('simulation.step', e, { tenant_id: run.tenant_id, run_id: run.id, level: level.id });
    await setRow(row.id, { status: 'failed', error: String(err?.message ?? e).slice(0, 300) });
    return true;
  }
  return false;
}

/**
 * What a learner would actually type: escaped characters the model wrote literally ("\\u20b9"
 * for ₹) decoded, runs of blank lines collapsed. The assessor quotes the transcript exactly, and
 * a literal "\\u20b9" made it quote "₹" and fail (live run, 8 Oct 2026).
 */
export function cleanMessage(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

// ---- runs ------------------------------------------------------------------------------------

export function calibrate(run: Pick<RunRow, 'config'>, rows: SimSessionRow[]): Calibration[] {
  return run.config.levels.map((id) => {
    const level = simLevel(id)!;
    const mine = rows.filter((r) => r.level === id).sort((a, b) => a.seq - b.seq);
    const practice = mine.filter((r) => r.kind === 'practice').map((r) => (r.final_percent === null ? null : Number(r.final_percent)));
    const a = mine.find((r) => r.kind === 'assessment');
    const assessment = a ? { percent: a.final_percent === null ? null : Number(a.final_percent), band: a.band_label } : null;
    const lastPractice = [...practice].reverse().find((x) => x !== null) ?? null;
    const judged = assessment?.percent ?? lastPractice;
    return {
      level: id, label: level.label, expected: `${level.expected_band.label} (${level.expected_band.min}–${level.expected_band.max})`, practice, assessment,
      judged_on: assessment?.percent != null ? 'assessment' : lastPractice != null ? 'last practice' : null,
      in_band: judged == null ? null : judged >= level.expected_band.min && judged <= level.expected_band.max,
    };
  });
}

export function calibrationNotes(cal: Calibration[], runId: string): string {
  const lines = [`These sessions include simulated AI candidates (simulation run ${runId.slice(0, 8)}); their learner turns are an AI playing a stated level.`];
  for (const c of cal) {
    const trend = c.practice.map((x) => (x == null ? '—' : String(Math.round(x)))).join(' → ');
    const verdict = c.in_band == null ? 'no score' : c.in_band ? 'within the expected band' : 'OUTSIDE the expected band';
    lines.push(`Simulated ${c.label} candidate: practice scores ${trend || 'none'}${c.assessment ? `; graded assessment ${c.assessment.percent ?? '—'} ${c.assessment.band ?? ''}` : ''}; expected ${c.expected}: ${verdict}.`);
  }
  return lines.join('\n');
}

async function complete(run: RunRow) {
  const rows = await sql<SimSessionRow[]>`SELECT * FROM rp.sim_session WHERE run_id = ${run.id}`;
  const cal = calibrate(run, rows);
  let trainingRunId: string | null = null;
  let note: string | null = null;
  if (run.config.train_after && rows.some((r) => r.status === 'done')) {
    try { trainingRunId = (await startTrainingRun(null, run.tenant_id, { trigger: 'manual', notes: calibrationNotes(cal, run.id), createdBy: `Simulation run ${run.id.slice(0, 8)}`, sessionIds: rows.flatMap((r) => (r.status === 'done' && r.session_id ? [r.session_id] : [])) })).id; }
    catch (e) { note = `The AI training agent was not started: ${(e as Error).message}`; }
  }
  await sql`UPDATE rp.sim_run SET status = 'completed', completed_at = now(), summary = ${sql.json(cal as never)}, training_run_id = ${trainingRunId}, error = ${note} WHERE id = ${run.id}`;
}

/**
 * Advance a run until the budget is used: every level takes steps in parallel; when all are done,
 * the run is completed (calibration, training agent). Returns false when busy elsewhere or finished.
 */
export async function advanceSimRun(runId: string, budgetMs = 240000): Promise<boolean> {
  const [run] = await sql<RunRow[]>`UPDATE rp.sim_run SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE id = ${runId} AND status = 'running' AND (lease_until IS NULL OR lease_until < now()) RETURNING *`;
  if (!run) return false;
  const until = Date.now() + budgetMs;
  try {
    const levels = run.config.levels.map((id) => simLevel(id)!).filter(Boolean);
    const active = await Promise.all(levels.map(async (level) => {
      let more = true;
      // Leave room for one more step (a candidate message and the reply, or an assessment).
      while (more && Date.now() < until - 45000) {
        const [cur] = await sql<{ status: string }[]>`SELECT status FROM rp.sim_run WHERE id = ${run.id}`;
        if (cur?.status !== 'running') return false;
        more = await stepLevel(run, level);
      }
      return more;
    }));
    const [cur] = await sql<{ status: string }[]>`SELECT status FROM rp.sim_run WHERE id = ${run.id}`;
    if (cur?.status === 'running' && !active.some(Boolean)) {
      const [left] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM rp.sim_session WHERE run_id = ${run.id} AND status NOT IN ('done','failed')`;
      if (!left.n) await complete(run);
    }
    return true;
  } catch (e) {
    logError('simulation.advance', e, { tenant_id: run.tenant_id, run_id: run.id });
    await sql`UPDATE rp.sim_run SET status = 'failed', completed_at = now(), error = ${(e as Error).message.slice(0, 300)} WHERE id = ${run.id}`;
    return true;
  } finally {
    await sql`UPDATE rp.sim_run SET lease_until = NULL WHERE id = ${runId}`;
  }
}

/** For the cron: advance every running simulation once. */
export async function advanceSimRuns(budgetMs = 200000) {
  const runs = await sql<{ id: string }[]>`SELECT id FROM rp.sim_run WHERE status = 'running' ORDER BY created_at`;
  let n = 0;
  for (const r of runs) if (await advanceSimRun(r.id, budgetMs)) n++;
  return n;
}

export async function cancelSimRun(actor: Actor, runId: string) {
  canRun(actor);
  const [r] = await sql`UPDATE rp.sim_run SET status = 'cancelled', completed_at = now() WHERE id = ${runId} AND tenant_id = ${actor.tenant_id} AND status = 'running' RETURNING id`;
  if (!r) throw new ApiError(409, 'SIM_NOT_RUNNING', 'This simulation is not running.');
  await audit(actor, 'simulation.run_cancelled', 'sim_run', runId, {});
}

export async function listSimRuns(actor: Actor, limit = 30) {
  canRun(actor);
  return sql<(RunRow & { sessions: number; done: number; failed: number })[]>`
    SELECT r.*, (SELECT count(*)::int FROM rp.sim_session x WHERE x.run_id = r.id) AS sessions,
      (SELECT count(*)::int FROM rp.sim_session x WHERE x.run_id = r.id AND x.status = 'done') AS done,
      (SELECT count(*)::int FROM rp.sim_session x WHERE x.run_id = r.id AND x.status = 'failed') AS failed
    FROM rp.sim_run r WHERE r.tenant_id = ${actor.tenant_id} ORDER BY r.created_at DESC LIMIT ${limit}`;
}

export async function getSimRun(actor: Actor, runId: string) {
  canRun(actor);
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw notFound('Simulation');
  const [run] = await sql<RunRow[]>`SELECT * FROM rp.sim_run WHERE id = ${runId} AND tenant_id = ${actor.tenant_id}`;
  if (!run) throw notFound('Simulation');
  const sessions = await sql<SimSessionRow[]>`SELECT * FROM rp.sim_session WHERE run_id = ${runId} ORDER BY level, seq`;
  return { run, sessions, calibration: run.summary ?? calibrate(run, sessions), levels: SIM_LEVELS.filter((l) => run.config.levels.includes(l.id)) };
}

/** Which simulated level, if any, a session belongs to (for the training agent). */
export async function simulatedLevelOf(sessionId: string): Promise<string | null> {
  const [r] = await sql<{ level: string }[]>`SELECT level FROM rp.sim_session WHERE session_id = ${sessionId} LIMIT 1`;
  return r ? simLevel(r.level)?.label ?? r.level : null;
}
