import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { gatherEvidence, pick, type Scenario, type Turn, type Lang } from './rules';
import { customerTurn, evaluate, toEnglish, type Evaluation } from './agents';

/**
 * Sales practice sessions: a candidate talks to an AI customer, then a separate
 * evaluator scores the transcript. See db/migrations/013_sales_simulation.sql.
 */

export type { Scenario, Turn, Lang, Evaluation };
export { pick } from './rules';

function toScenario(r: any): Scenario {
  return {
    id: r.id, version: r.version, title: r.title, product: r.product, skill: r.skill,
    difficulty: r.difficulty, durationMin: r.duration_min, maxTurns: r.max_turns, learnerRole: r.learner_role,
    learnerBrief: r.learner_brief, openingLine: r.opening_line, customerProfile: r.customer_profile,
    facts: r.facts, pitchDeflection: r.pitch_deflection, rubric: r.rubric, riskRules: r.risk_rules, bands: r.bands,
  };
}

export async function loadScenario(id: string, version?: string): Promise<Scenario> {
  const [row] = version
    ? await sql`SELECT * FROM app.simulation_scenario WHERE id=${id} AND version=${version}`
    : await sql`SELECT * FROM app.simulation_scenario WHERE id=${id} AND status='PUBLISHED' ORDER BY created_at DESC, version DESC LIMIT 1`;
  if (!row) throw new Error('This practice scenario is not available.');
  return toScenario(row);
}

export async function publishedScenarios() {
  return sql<{ id: string; version: string; title: string; product: string; skill: string; difficulty: string; duration_min: number; learner_role: string }[]>`
    SELECT DISTINCT ON (id) id, version, title, product, skill, difficulty, duration_min, learner_role
      FROM app.simulation_scenario WHERE status='PUBLISHED' ORDER BY id, created_at DESC, version DESC`;
}

const toTurn = (r: any): Turn => ({ seq: r.seq, speaker: r.speaker, text: r.text, textEn: r.text_en, revealedKeys: r.revealed_keys ?? [] });

async function turnsOf(sessionId: string): Promise<Turn[]> {
  return (await sql`SELECT * FROM app.simulation_turn WHERE session_id=${sessionId} ORDER BY seq`).map(toTurn);
}

export async function startSession(candidateId: string, scenarioId: string, lang: Lang, retryOf?: string | null) {
  const scenario = await loadScenario(scenarioId);
  let focus: string | null = null;
  if (retryOf) {
    const [prev] = await sql`SELECT e.retry FROM app.simulation_session s JOIN app.simulation_evaluation e ON e.session_id=s.id WHERE s.id=${retryOf} AND s.candidate_id=${candidateId}`;
    if (!prev) throw new Error('That attempt cannot be retried.');
    focus = prev.retry?.instruction ?? null;
  }
  const at = new Date();
  const id = await nextId('SIM');
  const opening = pick(scenario.openingLine, lang);
  await sql.begin(async (tx) => {
    // One live practice per candidate; an unfinished one is abandoned, not scored.
    await tx`UPDATE app.simulation_session SET status='ABANDONED', completed_at=${at} WHERE candidate_id=${candidateId} AND status='IN_PROGRESS'`;
    await tx`INSERT INTO app.simulation_session (id, candidate_id, scenario_id, scenario_version, language, status, retry_of, retry_focus, started_at)
             VALUES (${id}, ${candidateId}, ${scenario.id}, ${scenario.version}, ${lang}, 'IN_PROGRESS', ${retryOf ?? null}, ${focus}, ${at})`;
    await tx`INSERT INTO app.simulation_turn (session_id, seq, speaker, text, text_en, created_at)
             VALUES (${id}, 0, 'CUSTOMER', ${opening}, ${scenario.openingLine.en}, ${at})`;
  });
  return { sessionId: id };
}

async function ownSession(candidateId: string, sessionId: string) {
  const [s] = await sql`SELECT * FROM app.simulation_session WHERE id=${sessionId} AND candidate_id=${candidateId}`;
  if (!s) throw new Error('Practice session not found.');
  return s;
}

const expired = (s: any, scenario: Scenario) =>
  Date.now() > new Date(s.started_at).getTime() + (scenario.durationMin + 1) * 60_000;

export async function learnerTurn(candidateId: string, sessionId: string, text: string, mode: 'TEXT' | 'VOICE', sttConfidence: number | null) {
  const s = await ownSession(candidateId, sessionId);
  if (s.status !== 'IN_PROGRESS') throw new Error('This practice has ended.');
  const scenario = await loadScenario(s.scenario_id, s.scenario_version);
  if (expired(s, scenario)) { await endSession(candidateId, sessionId, 'TIMED_OUT'); return { ended: true as const }; }

  // Reserve the turn first. This bounds the session and gives both rows fixed
  // sequence numbers before any slow model call, so a double submit cannot interleave.
  const [slot] = await sql<{ turn_count: number }[]>`
    UPDATE app.simulation_session SET turn_count = turn_count + 1
     WHERE id=${sessionId} AND status='IN_PROGRESS' AND turn_count < ${scenario.maxTurns}
     RETURNING turn_count`;
  if (!slot) { await endSession(candidateId, sessionId, 'COMPLETED'); return { ended: true as const }; }

  const lang = s.language as Lang;
  const history = await turnsOf(sessionId);
  const learner: Turn = { seq: slot.turn_count * 2 - 1, speaker: 'LEARNER', text, textEn: await toEnglish(text, lang), revealedKeys: [] };
  const revealed = Object.keys(s.revealed ?? {});
  const askedSoFar = gatherEvidence(scenario, history).coverage.filter((c) => c.asked).length;
  const answer = await customerTurn(scenario, lang, history, learner, revealed, askedSoFar);
  const at = new Date();
  const replyEn = await toEnglish(answer.reply, lang);
  const newlyRevealed = Object.fromEntries(answer.revealedKeys.map((k) => [k, learner.seq]));

  await sql.begin(async (tx) => {
    await tx`INSERT INTO app.simulation_turn (session_id, seq, speaker, text, text_en, input_mode, stt_confidence, created_at)
             VALUES (${sessionId}, ${learner.seq}, 'LEARNER', ${text}, ${learner.textEn}, ${mode}, ${sttConfidence}, ${at})`;
    await tx`INSERT INTO app.simulation_turn (session_id, seq, speaker, text, text_en, revealed_keys, created_at)
             VALUES (${sessionId}, ${learner.seq + 1}, 'CUSTOMER', ${answer.reply}, ${replyEn}, ${tx.json(answer.revealedKeys as never)}, ${at})`;
    await tx`UPDATE app.simulation_session
                SET revealed = ${tx.json(newlyRevealed as never)}::jsonb || revealed,
                    pitched_early = pitched_early OR ${answer.pitchedEarly},
                    customer_agent = ${answer.agent}
              WHERE id=${sessionId}`;
  });
  return { ended: false as const, reply: answer.reply, seq: learner.seq + 1, turnsLeft: scenario.maxTurns - slot.turn_count };
}

export async function endSession(candidateId: string, sessionId: string, status: 'COMPLETED' | 'TIMED_OUT' = 'COMPLETED') {
  const [closed] = await sql`UPDATE app.simulation_session SET status=${status}, completed_at=${new Date()}
                             WHERE id=${sessionId} AND candidate_id=${candidateId} AND status='IN_PROGRESS' RETURNING *`;
  const s = closed ?? await ownSession(candidateId, sessionId);
  const [existing] = await sql`SELECT id FROM app.simulation_evaluation WHERE session_id=${sessionId}`;
  if (existing || s.status === 'ABANDONED') return { sessionId };

  const scenario = await loadScenario(s.scenario_id, s.scenario_version);
  const turns = await turnsOf(sessionId);
  const e = await evaluate(scenario, turns, s.language as Lang);
  const at = await now();
  await sql`
    INSERT INTO app.simulation_evaluation (
      id, session_id, rubric_version, evaluator, overall, max_score, band, dimension_scores, coverage, risk_flags,
      strengths, improvements, best_moment, missed_opportunity, retry, confidence, needs_review, created_at)
    VALUES (${await nextId('SEV')}, ${sessionId}, ${scenario.id + '@' + scenario.version}, ${e.evaluator}, ${e.overall}, ${e.maxScore}, ${e.band},
      ${sql.json(e.dimensions as never)}, ${sql.json(e.evidence.coverage as never)}, ${sql.json(e.evidence.riskFlags as never)},
      ${sql.json(e.strengths as never)}, ${sql.json(e.improvements as never)}, ${e.bestMoment}, ${e.missedOpportunity},
      ${sql.json(e.retry as never)}, ${e.confidence}, ${e.needsReview}, ${at})
    ON CONFLICT (session_id) DO NOTHING`;
  await recordBestResult(candidateId, at);
  return { sessionId };
}

/** The best completed result becomes a typed role attribute that matching and employers can read. */
async function recordBestResult(candidateId: string, at: Date) {
  const [best] = await sql`
    SELECT e.band, e.overall, e.max_score, s.scenario_id FROM app.simulation_evaluation e
      JOIN app.simulation_session s ON s.id=e.session_id
     WHERE s.candidate_id=${candidateId} ORDER BY e.overall DESC, e.created_at DESC LIMIT 1`;
  if (!best) return;
  const value = `${best.band} (${best.overall}/${best.max_score}, ${best.scenario_id})`;
  await sql`
    INSERT INTO app.candidate_attribute_value (id, candidate_id, attribute_key, value_text, collected_at)
    VALUES (${await nextId('ATV')}, ${candidateId}, 'sales_roleplay_band', ${value}, ${at})
    ON CONFLICT (candidate_id, attribute_key) DO UPDATE SET value_text=EXCLUDED.value_text, collected_at=EXCLUDED.collected_at`;
}

export async function sessionDetail(candidateId: string | null, sessionId: string) {
  const [s] = candidateId
    ? await sql`SELECT * FROM app.simulation_session WHERE id=${sessionId} AND candidate_id=${candidateId}`
    : await sql`SELECT * FROM app.simulation_session WHERE id=${sessionId}`;
  if (!s) return null;
  const [scenario, turns, [evaluation]] = await Promise.all([
    loadScenario(s.scenario_id, s.scenario_version),
    turnsOf(sessionId),
    sql`SELECT * FROM app.simulation_evaluation WHERE session_id=${sessionId}`,
  ]);
  return { session: s, scenario, turns, evaluation: evaluation ?? null };
}

export async function candidateSessions(candidateId: string) {
  return sql`
    SELECT s.id, s.scenario_id, s.language, s.status, s.started_at, s.completed_at, s.retry_of,
           e.overall, e.max_score, e.band, e.needs_review
      FROM app.simulation_session s LEFT JOIN app.simulation_evaluation e ON e.session_id=s.id
     WHERE s.candidate_id=${candidateId} ORDER BY s.started_at DESC LIMIT 20`;
}
