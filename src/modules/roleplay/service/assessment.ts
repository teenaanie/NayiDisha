import { sql } from '@/lib/db';
import { ApiError, audit, forbidden, notFound, requireRole, type Actor } from './context';
import { runtimeOf } from '../config/runtime-extension';
import type { ScenarioBundle, ScoreResult } from '../contracts/types';

type Tx = typeof sql;

/**
 * Graded assessment (owner request, 7 Oct 2026).
 *
 * The same scenario, customer and evaluator as practice, but no coaching: the
 * learner sees the overall score, the band and each skill's score with its
 * weighted contribution. One attempt per scenario, unlocked by a practice
 * report; a manager (or an operator, for anyone in the tenant) can allow a retake. Every attempt stays on record and
 * managers can open the full assessment (transcript, evidence, rationale).
 */

/** Practice states that count as "has a practice report". */
const PRACTISED = ['reported', 'report_partial', 'review_required'];

export interface AssessmentStatus {
  scenario_id: string;
  practised: boolean;
  attempts_used: number;
  attempts_allowed: number;
  can_start: boolean;
  /** Why the assessment cannot be started now, in words for the learner. */
  blocked_reason: string | null;
  active_session_id: string | null;
  attempts: { session_id: string; state: string; started_at: Date; final_percent: number | null; band_label: string | null }[];
}

export async function assessmentStatus(actor: Actor, scenarioId: string, conn: Tx = sql): Promise<AssessmentStatus> {
  const [p] = await conn<{ n: number }[]>`SELECT count(*)::int AS n FROM rp.session WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${actor.user_id}
    AND scenario_id = ${scenarioId} AND kind = 'practice' AND NOT is_preview AND state IN ${conn(PRACTISED)}`;
  const attempts = await conn<{ session_id: string; state: string; started_at: Date; final_percent: string | null; band_label: string | null }[]>`
    SELECT s.id AS session_id, s.state, s.started_at, r.score->>'final_percent' AS final_percent, r.score->>'band_label' AS band_label
      FROM rp.session s LEFT JOIN rp.evaluation_run r ON r.id = s.current_run_id
     WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = ${actor.user_id} AND s.scenario_id = ${scenarioId} AND s.kind = 'assessment'
     ORDER BY s.started_at DESC`;
  const [g] = await conn<{ n: number }[]>`SELECT count(*)::int AS n FROM rp.assessment_grant WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${actor.user_id} AND scenario_id = ${scenarioId} AND revoked_at IS NULL`;
  const allowed = 1 + (g?.n ?? 0);
  const active = attempts.find((a) => a.state === 'active');
  const practised = (p?.n ?? 0) > 0;
  const blocked = active ? 'Your assessment is in progress.'
    : !practised ? 'Complete one practice and read its report first.'
    : attempts.length >= allowed ? 'You have taken this assessment. Your manager or the NayiDisha team can allow another attempt.'
    : null;
  return {
    scenario_id: scenarioId, practised, attempts_used: attempts.length, attempts_allowed: allowed, can_start: !blocked, blocked_reason: blocked,
    active_session_id: active?.session_id ?? null,
    attempts: attempts.map((a) => ({ ...a, final_percent: a.final_percent === null ? null : Number(a.final_percent) })),
  };
}

/**
 * Inside the start transaction: one learner, one scenario at a time (advisory lock), then the
 * same checks as assessmentStatus, so two quick clicks cannot use two attempts.
 */
export async function assertCanStartAssessment(tx: Tx, actor: Actor, scenarioId: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`assessment:${actor.tenant_id}:${actor.user_id}:${scenarioId}`}))`;
  const st = await assessmentStatus(actor, scenarioId, tx);
  if (!st.can_start) throw new ApiError(409, st.active_session_id ? 'ASSESSMENT_IN_PROGRESS' : !st.practised ? 'PRACTICE_FIRST' : 'ASSESSMENT_TAKEN', st.blocked_reason!, false, st.active_session_id ? { session_id: st.active_session_id } : {});
}

// ---- the score ------------------------------------------------------------------

export interface AssessmentSkill {
  dimension_id: string; name: string; score: number; max_score: number; level_label: string | null;
  /** Share of the overall score (weights normalised to 100 over the skills that were scored). */
  weight_percent: number;
  /** This skill's weighted points out of weight_percent; they add up to the score before any cap. */
  points: number;
  /** points as a percentage of the skill's weight (= score / max). */
  percent_of_section: number;
  status: string;
}
export interface AssessmentScore {
  final_percent: number; band_label: string; base_percent: number;
  capped: boolean; adjustments: string[];
  skills: AssessmentSkill[];
  bands: { label: string; lower: number; upper: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The learner's score sheet: overall, band, and each skill's weighted contribution. */
export function assessmentScore(bundle: ScenarioBundle, score: ScoreResult, dims: { dimension_id: string; score: number; status: string }[]): AssessmentScore {
  const excluded = new Set((score.excluded_dimensions ?? []).map((x) => x.dimension_id));
  const weighted = bundle.scoring.mode === 'weighted_percent';
  const order = bundle.rubric.dimensions.map((d) => d.id);
  const scored = bundle.rubric.dimensions.filter((d) => !excluded.has(d.id) && dims.some((x) => x.dimension_id === d.id));
  const weightOf = (id: string) => (weighted ? Number(bundle.scoring.weights?.[id] ?? 0) : 1);
  const totalWeight = scored.reduce((n, d) => n + weightOf(d.id), 0) || 1;
  const labels = runtimeOf(bundle).evaluation_guide?.level_labels ?? null;
  const skills = [...dims].sort((a, b) => order.indexOf(a.dimension_id) - order.indexOf(b.dimension_id)).map((d) => {
    const def = bundle.rubric.dimensions.find((x) => x.id === d.dimension_id)!;
    const share = excluded.has(d.dimension_id) ? 0 : (100 * weightOf(d.dimension_id)) / totalWeight;
    const frac = def.max_score ? d.score / def.max_score : 0;
    return {
      dimension_id: d.dimension_id, name: def.name, score: d.score, max_score: def.max_score, level_label: labels?.[String(d.score)] ?? null,
      weight_percent: round1(share), points: round1(share * frac), percent_of_section: Math.round(frac * 100), status: excluded.has(d.dimension_id) ? 'not_scored' : d.status,
    };
  });
  return {
    final_percent: score.final_percent, band_label: score.band_label, base_percent: score.base_percent,
    capped: score.adjustments.some((a) => a.type === 'cap' && a.after < a.before), adjustments: score.adjustments.map((a) => a.detail),
    skills, bands: bundle.scoring.bands.map((b) => ({ label: b.label, lower: b.lower, upper: b.upper })),
  };
}

// ---- managers -------------------------------------------------------------------------

async function assertManages(actor: Actor, learnerId: string) {
  requireRole(actor, 'manager');
  if (!actor.managed_team_ids.length) throw forbidden('You can only manage learners in your teams.');
  const [m] = await sql`SELECT 1 FROM rp.team_membership WHERE user_id = ${learnerId} AND tenant_id = ${actor.tenant_id} AND role = 'member'
    AND team_id = ANY(${actor.managed_team_ids}) AND (valid_to IS NULL OR valid_to > now())`;
  if (!m) throw forbidden('You can only manage learners in your teams.');
}

/** Graded assessments of the manager's learners, newest first, with attempts used and allowed. */
export async function listTeamAssessments(actor: Actor) {
  requireRole(actor, 'manager');
  if (!actor.managed_team_ids.length) return [];
  return sql<{ session_id: string; learner_id: string; learner: string; scenario_id: string; title: string; scenario_version: string; state: string; started_at: Date; final_percent: string | null; band_label: string | null; attempts_used: number; attempts_allowed: number }[]>`
    SELECT s.id AS session_id, s.learner_id, u.display_name AS learner, s.scenario_id, v.bundle->'scenario'->>'title' AS title, s.scenario_version, s.state, s.started_at,
           r.score->>'final_percent' AS final_percent, r.score->>'band_label' AS band_label,
           (SELECT count(*)::int FROM rp.session x WHERE x.tenant_id = s.tenant_id AND x.learner_id = s.learner_id AND x.scenario_id = s.scenario_id AND x.kind = 'assessment') AS attempts_used,
           1 + (SELECT count(*)::int FROM rp.assessment_grant g WHERE g.tenant_id = s.tenant_id AND g.learner_id = s.learner_id AND g.scenario_id = s.scenario_id AND g.revoked_at IS NULL) AS attempts_allowed
      FROM rp.session s JOIN rp.app_user u ON u.id = s.learner_id JOIN rp.scenario_version v ON v.id = s.scenario_version_id
      LEFT JOIN rp.evaluation_run r ON r.id = s.current_run_id
     WHERE s.tenant_id = ${actor.tenant_id} AND s.kind = 'assessment'
       AND EXISTS (SELECT 1 FROM rp.team_membership m WHERE m.user_id = s.learner_id AND m.tenant_id = s.tenant_id AND m.role = 'member'
                   AND m.team_id = ANY(${actor.managed_team_ids}) AND (m.valid_to IS NULL OR m.valid_to > now()))
     ORDER BY s.started_at DESC LIMIT 200`;
}

/** Let a learner take the assessment once more. Only when every allowed attempt has been used. */
export async function grantRetake(actor: Actor, input: { learner_id?: string; scenario_id?: string; reason?: string }) {
  const learnerId = String(input?.learner_id ?? ''); const scenarioId = String(input?.scenario_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(learnerId) || !scenarioId) throw new ApiError(400, 'BAD_INPUT', 'learner_id and scenario_id are required.');
  await assertManages(actor, learnerId);
  if (learnerId === actor.user_id) throw forbidden('You cannot allow your own retake.');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`assessment:${actor.tenant_id}:${learnerId}:${scenarioId}`}))`;
    const [u] = await tx<{ used: number; allowed: number }[]>`
      SELECT (SELECT count(*)::int FROM rp.session WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${learnerId} AND scenario_id = ${scenarioId} AND kind = 'assessment') AS used,
             1 + (SELECT count(*)::int FROM rp.assessment_grant WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${learnerId} AND scenario_id = ${scenarioId} AND revoked_at IS NULL) AS allowed`;
    if (!u.used) throw notFound('Assessment');
    if (u.used < u.allowed) throw new ApiError(409, 'RETAKE_AVAILABLE', 'This learner can already take the assessment again.');
    const [g] = await tx<{ id: string }[]>`INSERT INTO rp.assessment_grant (tenant_id, learner_id, scenario_id, granted_by, reason)
      VALUES (${actor.tenant_id}, ${learnerId}, ${scenarioId}, ${actor.user_id}, ${(input.reason ?? '').trim().slice(0, 500) || null}) RETURNING id`;
    await audit(actor, 'assessment.retake_granted', 'app_user', learnerId, { scenario_id: scenarioId, grant_id: g.id, attempts_allowed: u.allowed + 1 }, {}, tx as never);
    return { grant_id: g.id, attempts_allowed: u.allowed + 1 };
  });
}

// ---- operators -------------------------------------------------------------------------
// Operators (NayiDisha operations and administrators) see every learner in the tenant, so
// signed-in candidates, who are on no team and have no manager, are covered too.

export interface OperatorAssessmentRow {
  learner_id: string; learner: string; subject: string; scenario_id: string; title: string | null;
  practised: boolean; attempts_used: number; attempts_allowed: number; last_activity: Date | null;
  attempts: { session_id: string; state: string; started_at: string; final_percent: number | null; band_label: string | null }[];
  grants: { created_at: string; granted_by: string; reason: string | null; revoked_at: string | null; revoked_by: string | null }[];
}

/**
 * One row per learner and scenario that has a practice report, a graded attempt or a grant:
 * attempts used and allowed, every graded attempt (newest first) and the grant history.
 */
export async function listOperatorAssessments(actor: Actor, q: { search?: string } = {}): Promise<OperatorAssessmentRow[]> {
  requireRole(actor, 'operator');
  const search = (q.search ?? '').trim().slice(0, 80);
  const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  return sql<OperatorAssessmentRow[]>`
    WITH pairs AS (
      SELECT DISTINCT learner_id, scenario_id FROM rp.session
       WHERE tenant_id = ${actor.tenant_id} AND NOT is_preview AND (kind = 'assessment' OR (kind = 'practice' AND state IN ${sql(PRACTISED)}))
      UNION
      SELECT learner_id, scenario_id FROM rp.assessment_grant WHERE tenant_id = ${actor.tenant_id}
    )
    SELECT p.learner_id, u.display_name AS learner, u.subject, p.scenario_id,
           (SELECT v.bundle->'scenario'->>'title' FROM rp.session s JOIN rp.scenario_version v ON v.id = s.scenario_version_id
             WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = p.learner_id AND s.scenario_id = p.scenario_id ORDER BY s.started_at DESC LIMIT 1) AS title,
           EXISTS (SELECT 1 FROM rp.session s WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = p.learner_id AND s.scenario_id = p.scenario_id
                    AND s.kind = 'practice' AND NOT s.is_preview AND s.state IN ${sql(PRACTISED)}) AS practised,
           (SELECT count(*)::int FROM rp.session s WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = p.learner_id AND s.scenario_id = p.scenario_id AND s.kind = 'assessment') AS attempts_used,
           1 + (SELECT count(*)::int FROM rp.assessment_grant g WHERE g.tenant_id = ${actor.tenant_id} AND g.learner_id = p.learner_id AND g.scenario_id = p.scenario_id AND g.revoked_at IS NULL) AS attempts_allowed,
           (SELECT max(s.started_at) FROM rp.session s WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = p.learner_id AND s.scenario_id = p.scenario_id AND NOT s.is_preview) AS last_activity,
           (SELECT COALESCE(json_agg(json_build_object('session_id', s.id, 'state', s.state, 'started_at', s.started_at,
                     'final_percent', (r.score->>'final_percent')::numeric, 'band_label', r.score->>'band_label') ORDER BY s.started_at DESC), '[]'::json)
              FROM rp.session s LEFT JOIN rp.evaluation_run r ON r.id = s.current_run_id
             WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = p.learner_id AND s.scenario_id = p.scenario_id AND s.kind = 'assessment') AS attempts,
           (SELECT COALESCE(json_agg(json_build_object('created_at', g.created_at, 'granted_by', gb.display_name, 'reason', g.reason,
                     'revoked_at', g.revoked_at, 'revoked_by', rb.display_name) ORDER BY g.created_at DESC), '[]'::json)
              FROM rp.assessment_grant g JOIN rp.app_user gb ON gb.id = g.granted_by LEFT JOIN rp.app_user rb ON rb.id = g.revoked_by
             WHERE g.tenant_id = ${actor.tenant_id} AND g.learner_id = p.learner_id AND g.scenario_id = p.scenario_id) AS grants
      FROM pairs p JOIN rp.app_user u ON u.id = p.learner_id AND u.tenant_id = ${actor.tenant_id}
     WHERE ${search ? sql`(u.display_name ILIKE ${like} OR p.scenario_id ILIKE ${like})` : sql`TRUE`}
     ORDER BY last_activity DESC NULLS LAST, u.display_name LIMIT 300`;
}

/** Most attempts an operator can allow for one scenario. */
export const MAX_ASSESSMENT_ATTEMPTS = 10;

/**
 * Set how many graded attempts a learner has for a scenario. Raising it adds grants; lowering
 * it withdraws the newest unused ones (kept on record as revoked). It cannot go below the
 * attempts already used (an attempt in progress counts as used) or below one.
 */
export async function setAssessmentAttempts(actor: Actor, input: { learner_id?: string; scenario_id?: string; attempts_allowed?: number; reason?: string }) {
  requireRole(actor, 'operator');
  const learnerId = String(input?.learner_id ?? ''); const scenarioId = String(input?.scenario_id ?? '').trim();
  const target = Number(input?.attempts_allowed);
  if (!/^[0-9a-f-]{36}$/i.test(learnerId) || !scenarioId || scenarioId.length > 120) throw new ApiError(400, 'BAD_INPUT', 'learner_id and scenario_id are required.');
  if (!Number.isInteger(target) || target < 1 || target > MAX_ASSESSMENT_ATTEMPTS) throw new ApiError(422, 'BAD_ATTEMPTS', `Choose between 1 and ${MAX_ASSESSMENT_ATTEMPTS} attempts.`);
  if (learnerId === actor.user_id) throw forbidden('You cannot change your own attempts.');
  const [learner] = await sql`SELECT 1 FROM rp.app_user WHERE id = ${learnerId} AND tenant_id = ${actor.tenant_id}`;
  if (!learner) throw notFound('Learner');
  const reason = (input.reason ?? '').trim().slice(0, 500) || null;
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`assessment:${actor.tenant_id}:${learnerId}:${scenarioId}`}))`;
    const [u] = await tx<{ used: number; allowed: number }[]>`
      SELECT (SELECT count(*)::int FROM rp.session WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${learnerId} AND scenario_id = ${scenarioId} AND kind = 'assessment') AS used,
             1 + (SELECT count(*)::int FROM rp.assessment_grant WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${learnerId} AND scenario_id = ${scenarioId} AND revoked_at IS NULL) AS allowed`;
    if (target < u.used) throw new ApiError(409, 'BELOW_USED', `This learner has already used ${u.used} attempt${u.used === 1 ? '' : 's'}; the number cannot be lower than that.`);
    if (target > u.allowed) {
      for (let i = u.allowed; i < target; i++) await tx`INSERT INTO rp.assessment_grant (tenant_id, learner_id, scenario_id, granted_by, reason) VALUES (${actor.tenant_id}, ${learnerId}, ${scenarioId}, ${actor.user_id}, ${reason})`;
    } else if (target < u.allowed) {
      await tx`UPDATE rp.assessment_grant SET revoked_at = now(), revoked_by = ${actor.user_id}
                WHERE id IN (SELECT id FROM rp.assessment_grant WHERE tenant_id = ${actor.tenant_id} AND learner_id = ${learnerId} AND scenario_id = ${scenarioId} AND revoked_at IS NULL
                              ORDER BY created_at DESC LIMIT ${u.allowed - target})`;
    }
    if (target !== u.allowed) await audit(actor, 'assessment.attempts_set', 'app_user', learnerId, { scenario_id: scenarioId, before: u.allowed, after: target, reason }, {}, tx as never);
    return { attempts_used: u.used, attempts_allowed: target, changed: target !== u.allowed };
  });
}
