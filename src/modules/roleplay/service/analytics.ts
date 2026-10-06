import { sql } from '@/lib/db';
import { forbidden, requireRole, type Actor } from './context';

/**
 * Manager analytics (spec §21). Definitions, stated where they are computed:
 *
 *   completion rate   reported full sessions / started full sessions in the window;
 *                     abandoned and still-processing are shown separately.
 *   average score     one assessment per session: the first valid full one
 *                     (selection policy "first_valid_full"); failed and focused
 *                     assessments are excluded.
 *   coverage rate     sessions whose check was observed / eligible completed full sessions.
 *   risk rate         sessions with at least one confirmed, not-dismissed risk /
 *                     eligible completed full sessions; pending review shown separately.
 *   retry improvement paired full attempts (child retry vs its parent), same
 *                     scenario and a comparable version; sample size and elapsed time shown.
 *   readiness         advisory band distribution of each learner's latest full attempt.
 *                     Never an automatic employment decision.
 *
 * Results are grouped by scenario, rubric version and scoring version; unlike
 * raw totals are never combined. Cohorts under the tenant threshold (default
 * five learners) are suppressed.
 */

export interface AnalyticsQuery { team_id: string; from?: string; to?: string; scenario_id?: string }

export async function managerAnalytics(actor: Actor, q: AnalyticsQuery) {
  requireRole(actor, 'manager');
  if (!q.team_id || !actor.managed_team_ids.includes(q.team_id)) throw forbidden('You can only view teams you manage.');
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 90 * 86400000);
  const to = q.to ? new Date(q.to) : new Date(Date.now() + 60000);
  const [t] = await sql<{ settings: { min_cohort?: number } }[]>`SELECT settings FROM rp.tenant WHERE id = ${actor.tenant_id}`;
  const minCohort = t?.settings?.min_cohort ?? 5;

  const learners = await sql<{ user_id: string; display_name: string }[]>`
    SELECT u.id AS user_id, u.display_name FROM rp.team_membership m JOIN rp.app_user u ON u.id = m.user_id
     WHERE m.team_id = ${q.team_id} AND m.tenant_id = ${actor.tenant_id} AND m.role = 'member' AND (m.valid_to IS NULL OR m.valid_to > ${from})`;
  const ids = learners.map((l) => l.user_id);

  const sessions = await sql<{ id: string; learner_id: string; scenario_id: string; rubric_version: string; scoring_version: string; state: string; mode: string; parent_session_id: string | null; comparable: boolean | null; started_at: Date }[]>`
    SELECT id, learner_id, scenario_id, rubric_version, scoring_version, state, COALESCE(retry_scope->>'mode','full') AS mode, parent_session_id,
           (retry_scope->>'comparable')::boolean AS comparable, started_at
      FROM rp.session WHERE tenant_id = ${actor.tenant_id} AND learner_id = ANY(${ids}) AND NOT is_preview AND kind = 'practice'
       AND started_at >= ${from} AND started_at < ${to} ${q.scenario_id ? sql`AND scenario_id = ${q.scenario_id}` : sql``}`;
  const facts = await sql<{ run_id: string; session_id: string; learner_id: string; scenario_id: string; rubric_version: string; scoring_version: string; mode: string; raw_total: number | null; raw_max: number | null; final_percent: string | null; band_id: string | null; dimension_scores: Record<string, number>; check_results: Record<string, string>; confirmed_risk: boolean; pending_review: boolean; parent_session_id: string | null; completed_at: Date }[]>`
    SELECT DISTINCT ON (session_id) * FROM rp.analytics_fact
     WHERE tenant_id = ${actor.tenant_id} AND learner_id = ANY(${ids}) AND completed_at >= ${from} AND completed_at < ${to}
       AND status IN ('reported','report_partial') ${q.scenario_id ? sql`AND scenario_id = ${q.scenario_id}` : sql``}
     ORDER BY session_id, completed_at`;   // first valid assessment per session

  const groups = new Map<string, { scenario_id: string; rubric_version: string; scoring_version: string }>();
  for (const s of sessions) groups.set(`${s.scenario_id}|${s.rubric_version}|${s.scoring_version}`, { scenario_id: s.scenario_id, rubric_version: s.rubric_version, scoring_version: s.scoring_version });

  const out = [...groups.values()].map((g) => {
    const inG = <T extends { scenario_id: string; rubric_version: string; scoring_version: string }>(x: T) => x.scenario_id === g.scenario_id && x.rubric_version === g.rubric_version && x.scoring_version === g.scoring_version;
    const gs = sessions.filter(inG);
    const full = gs.filter((s) => s.mode === 'full');
    const gf = facts.filter(inG);
    const fullFacts = gf.filter((f) => f.mode === 'full' && f.raw_total !== null);
    const learnerCount = new Set(gs.map((s) => s.learner_id)).size;
    const suppressed = learnerCount < minCohort;
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : null);
    const dimIds = Array.from(new Set(fullFacts.flatMap((f) => Object.keys(f.dimension_scores))));
    const checkIds = Array.from(new Set(fullFacts.flatMap((f) => Object.keys(f.check_results))));

    // Retry pairs: a full child and its parent, both assessed, same version group.
    const byId = new Map(fullFacts.map((f) => [f.session_id, f]));
    const pairs = full.filter((s) => s.parent_session_id && s.comparable !== false).flatMap((child) => {
      const c = byId.get(child.id); const p = child.parent_session_id ? byId.get(child.parent_session_id) : undefined;
      // Points out of 100: comparable for raw-sum and weighted scoring alike.
      return c && p ? [{ delta: Math.round((Number(c.final_percent) - Number(p.final_percent)) * 10) / 10, days: (new Date(c.completed_at).getTime() - new Date(p.completed_at).getTime()) / 86400000 }] : [];
    });
    const focused = gf.filter((f) => f.mode === 'focused');
    const latest = new Map<string, typeof fullFacts[number]>();
    for (const f of [...fullFacts].sort((a, b) => +new Date(a.completed_at) - +new Date(b.completed_at))) latest.set(f.learner_id, f);

    return {
      ...g,
      learners: learnerCount,
      suppressed,
      counts: {
        started_full: full.length,
        reported_full: full.filter((s) => ['reported', 'report_partial'].includes(s.state)).length,
        abandoned: full.filter((s) => s.state === 'abandoned').length,
        processing: full.filter((s) => ['completed', 'evaluating', 'coaching', 'review_required'].includes(s.state)).length,
        evaluation_failed: full.filter((s) => s.state === 'evaluation_failed').length,
        focused_attempts: focused.length,
      },
      metrics: suppressed ? null : {
        completion_rate: full.length ? Math.round((1000 * full.filter((s) => ['reported', 'report_partial'].includes(s.state)).length) / full.length) / 10 : null,
        average_raw: avg(fullFacts.map((f) => f.raw_total!)), raw_max: fullFacts[0]?.raw_max ?? null,
        average_percent: avg(fullFacts.map((f) => Number(f.final_percent))),
        dimension_averages: Object.fromEntries(dimIds.map((d) => [d, avg(fullFacts.map((f) => f.dimension_scores[d]).filter((x) => x !== undefined))])),
        coverage_rates: Object.fromEntries(checkIds.map((c) => [c, fullFacts.length ? Math.round((1000 * fullFacts.filter((f) => f.check_results[c] === 'observed').length) / fullFacts.length) / 10 : null])),
        risk_rate: fullFacts.length ? Math.round((1000 * fullFacts.filter((f) => f.confirmed_risk).length) / fullFacts.length) / 10 : null,
        pending_review: gs.filter((s) => s.state === 'review_required').length,
        retry_improvement: { pairs: pairs.length, average_delta: avg(pairs.map((p) => p.delta)), average_days_between: avg(pairs.map((p) => p.days)) },
        focused_target_checks_observed: focused.length ? focused.flatMap((f) => Object.entries(f.check_results)).filter(([, v]) => v === 'observed').length : 0,
        readiness_advisory: Object.entries([...latest.values()].reduce<Record<string, number>>((acc, f) => { acc[f.band_id ?? 'unknown'] = (acc[f.band_id ?? 'unknown'] ?? 0) + 1; return acc; }, {})).map(([band, n]) => ({ band, learners: n })),
      },
      eligible_assessments: fullFacts.length,
    };
  });
  return { team_id: q.team_id, window: { from, to }, min_cohort: minCohort, selection_policy: 'first_valid_full', groups: out };
}

export async function managedTeams(actor: Actor) {
  if (!actor.roles.includes('manager')) return [];
  return sql<{ id: string; name: string }[]>`SELECT id, name FROM rp.team WHERE tenant_id = ${actor.tenant_id} AND id = ANY(${actor.managed_team_ids}) ORDER BY name`;
}
