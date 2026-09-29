import { sql } from '@/lib/db';
import type { ScenarioBundle, TranscriptTurn, EvaluationCandidate, ScoreResult, CoachingReport } from '../contracts/types';
import { assess, EVALUATOR_VERSION, rubricVersionOf, type AssessResult } from '../evaluation/assess';
import { scoreAssessment } from '../scoring';
import { buildCoachInput, validateCoaching, focusedCheckpoint, COACH_SCHEMA_VERSION, NO_RISK_TEXT } from '../coaching';
import { completeWithRetry } from '../providers';
import { coachingCandidateSchema } from '../contracts/schemas';
import { ApiError, audit, conflict, forbidden, metric, notFound, requireRole, type Actor } from './context';
import { enqueue, registerHandler, PermanentJobError, type Job } from './jobs';
import { spendProviderBudget, idempotent } from './guards';
import { promptContent } from './registry';
import { loadBundle, loadSessionFor, startSession, type SessionRow, type RetryScope } from './sessions';

/**
 * Evaluation, coaching, review and retries (spec §13–§14, §19–§20).
 *
 * The evaluator runs against the immutable snapshot only. Every provider
 * output is kept with its validation result; the accepted candidate, the
 * deterministic score and the report are stored separately, so arithmetic and
 * report selection replay without a model call (FR12).
 */

type Tx = typeof sql;

export async function enqueueEvaluation(tx: Tx, s: SessionRow, snapshotId: string, hash: string) {
  const mode = s.retry_scope?.mode === 'focused' ? 'focused' : 'full';
  const dedupe = `${hash}|${s.bundle_hash}|${EVALUATOR_VERSION}|${mode}`;
  const [existing] = await tx<{ id: string }[]>`SELECT id FROM rp.evaluation_run WHERE dedupe_key = ${dedupe} ORDER BY attempt DESC LIMIT 1`;
  const run = existing ?? (await tx<{ id: string }[]>`
    INSERT INTO rp.evaluation_run (tenant_id, session_id, snapshot_id, mode, dedupe_key, attempt, status, evaluator_version, prompt_versions)
    VALUES (${s.tenant_id}, ${s.id}, ${snapshotId}, ${mode}, ${dedupe}, 1, 'queued', ${EVALUATOR_VERSION}, ${tx.json(s.prompt_versions as never)}) RETURNING id`)[0];
  const [op] = await tx<{ id: string }[]>`INSERT INTO rp.operation (tenant_id, session_id, kind, status, run_id) VALUES (${s.tenant_id}, ${s.id}, 'evaluation', 'pending', ${run.id}) RETURNING id`;
  await tx`UPDATE rp.session SET state = 'evaluating', current_run_id = ${run.id} WHERE id = ${s.id}`;
  await enqueue(tx, s.tenant_id, 'evaluate', `evaluate:${run.id}`, { run_id: run.id, operation_id: op.id });
  return { run_id: run.id, operation_id: op.id };
}

async function runContext(runId: string) {
  const [run] = await sql<{ id: string; tenant_id: string; session_id: string; snapshot_id: string; mode: 'full' | 'focused'; status: string; attempt: number }[]>`SELECT * FROM rp.evaluation_run WHERE id = ${runId}`;
  if (!run) throw new PermanentJobError('Run missing.');
  const [s] = await sql<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${run.session_id}`;
  const [snap] = await sql<{ content: TranscriptTurn[]; hash: string }[]>`SELECT content, hash FROM rp.transcript_snapshot WHERE id = ${run.snapshot_id}`;
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  return { run, s, snap, bundle };
}

async function processEvaluate(job: Job) {
  const { run, s, snap, bundle } = await runContext(String(job.payload.run_id));
  if (!['queued', 'evaluating'].includes(run.status)) return;
  await sql`UPDATE rp.evaluation_run SET status = 'evaluating' WHERE id = ${run.id}`;
  await sql`UPDATE rp.session SET state = 'evaluating' WHERE id = ${s.id} AND current_run_id = ${run.id}`;
  await spendProviderBudget(s.tenant_id);
  const template = await promptContent(s.prompt_versions.evaluator.id);
  if (template.digest !== s.prompt_versions.evaluator.digest) throw new PermanentJobError('Pinned evaluator prompt digest mismatch.');
  const started = Date.now();
  const recorded = await sql<{ turn_id: string; intents: { intent_id: string; question: boolean; start?: number; end?: number }[] }[]>`
    SELECT turn_id, intents FROM rp.turn_analysis WHERE session_id = ${s.id}`;
  const result = await assess({
    recordedIntents: new Map(recorded.map((r) => [r.turn_id, r.intents])),
    bundle, turns: snap.content, session_id: s.id, transcript_hash: snap.hash, mode: run.mode,
    target_check_ids: s.retry_scope?.target_check_ids ?? [], template: template.content,
    correlation: { tenant_id: s.tenant_id, session_id: s.id, evaluation_id: run.id },
  });
  await storeAssessment(run.id, s, bundle, result, String(job.payload.operation_id));
  await metric('evaluation_ms', Date.now() - started, { status: result.status, mode: run.mode, rejected_outputs: result.outputs.filter((o) => !o.ok).length }, s.tenant_id);
}

async function storeAssessment(runId: string, s: SessionRow, bundle: ScenarioBundle, result: AssessResult, operationId: string) {
  await sql.begin(async (tx) => {
    const outputs = result.outputs.map((o) => ({ attempt: o.attempt, ok: o.ok, errors: o.errors, notes: o.notes ?? [], provider: o.provider, model: o.model, request_id: o.request_id, latency_ms: o.latency_ms, usage: o.usage, text: o.text }));
    if (result.status !== 'scored') {
      await tx`UPDATE rp.evaluation_run SET status = 'evaluation_failed', outputs = ${tx.json(outputs as never)}, error = ${tx.json({ code: result.status === 'unscorable' ? 'UNSCORABLE' : 'EVALUATION_INVALID', reason: result.reason } as never)}, completed_at = now() WHERE id = ${runId}`;
      await tx`UPDATE rp.session SET state = 'evaluation_failed', revision = revision + 1 WHERE id = ${s.id} AND current_run_id = ${runId}`;
      await tx`UPDATE rp.operation SET status = 'failed', error = ${tx.json({ code: 'EVALUATION_FAILED', retryable: true, message: 'Your conversation is saved, but it could not be assessed. An administrator can retry the assessment.' } as never)}, updated_at = now() WHERE id = ${operationId}`;
      return;
    }
    const c = result.candidate;
    for (const e of c.evidence) {
      await tx`INSERT INTO rp.evidence (run_id, id, tenant_id, check_id, category, status, learner_spans, context_spans, searched_turn_ids, explanation, method, confidence, rule_version)
               VALUES (${runId}, ${e.id}, ${s.tenant_id}, ${e.check_id ?? null}, ${e.category}, ${e.status}, ${tx.json(e.learner_spans as never)}, ${tx.json(e.context_spans as never)},
                       ${tx.json(e.searched_turn_ids as never)}, ${e.explanation}, ${e.method}, ${e.confidence}, ${e.rule_version ?? null}) ON CONFLICT DO NOTHING`;
    }
    for (const d of c.dimension_scores) {
      await tx`INSERT INTO rp.dimension_score (run_id, dimension_id, tenant_id, score, anchor_score, evidence_ids, rationale, status)
               VALUES (${runId}, ${d.dimension_id}, ${s.tenant_id}, ${d.score}, ${d.anchor_score}, ${tx.json(d.evidence_ids as never)}, ${d.rationale}, ${d.status}) ON CONFLICT DO NOTHING`;
    }
    const ruleIds = new Set(result.rule.risk_candidates.map((r) => r.rule_id));
    for (const f of c.risk_flags) {
      const r = bundle.risk_policy.rules.find((x) => x.id === f.rule_id)!;
      await tx`INSERT INTO rp.risk_finding (run_id, rule_id, tenant_id, evidence_ids, status, source, severity, consequence)
               VALUES (${runId}, ${f.rule_id}, ${s.tenant_id}, ${tx.json(f.evidence_ids as never)}, ${f.status}, ${ruleIds.has(f.rule_id) ? 'both' : 'model'}, ${r.severity}, ${r.consequence}) ON CONFLICT DO NOTHING`;
    }
    const review = result.review_reasons.length > 0;
    const next = review ? 'review_required' : 'coaching';
    await tx`UPDATE rp.evaluation_run SET status = ${next}, outputs = ${tx.json(outputs as never)}, candidate = ${tx.json(c as never)},
                    review_reasons = ${tx.json(result.review_reasons as never)}, score = ${result.score ? tx.json(result.score as never) : null},
                    focused_results = ${result.focused ? tx.json(result.focused as never) : null},
                    provider = ${result.outputs.at(-1)?.provider ?? null}, model = ${result.outputs.at(-1)?.model ?? null}
              WHERE id = ${runId}`;
    await tx`UPDATE rp.session SET state = ${next}, revision = revision + 1 WHERE id = ${s.id} AND current_run_id = ${runId}`;
    await tx`UPDATE rp.operation SET status = 'succeeded', updated_at = now() WHERE id = ${operationId}`;
    // A provisional report is produced even while review is pending, labelled as such (spec §19).
    await enqueue(tx, s.tenant_id, 'coach', `coach:${runId}:${review ? 'provisional' : 'final'}`, { run_id: runId });
  });
}

registerHandler('evaluate', processEvaluate, async (job) => {
  const runId = String(job.payload.run_id);
  const [run] = await sql<{ session_id: string; status: string }[]>`SELECT session_id, status FROM rp.evaluation_run WHERE id = ${runId}`;
  if (!run || !['queued', 'evaluating'].includes(run.status)) return;
  await sql`UPDATE rp.evaluation_run SET status = 'evaluation_failed', error = ${sql.json({ code: 'EVALUATION_UNAVAILABLE', reason: 'Retries exhausted.' } as never)}, completed_at = now() WHERE id = ${runId}`;
  await sql`UPDATE rp.session SET state = 'evaluation_failed', revision = revision + 1 WHERE id = ${run.session_id} AND current_run_id = ${runId}`;
  await sql`UPDATE rp.operation SET status = 'failed', error = ${sql.json({ code: 'EVALUATION_FAILED', retryable: true } as never)}, updated_at = now() WHERE run_id = ${runId} AND status = 'pending'`;
});

// ---- coaching ---------------------------------------------------------------------

function retryOptions(bundle: ScenarioBundle) {
  return { full_enabled: bundle.retry.full_enabled, focused_enabled: bundle.retry.focused_enabled, focused_target_check_ids: bundle.retry.focused_target_check_ids, instruction: bundle.retry.instruction };
}

async function processCoach(job: Job) {
  const { run, s, snap, bundle } = await runContext(String(job.payload.run_id));
  const [full] = await sql<{ candidate: EvaluationCandidate; status: string; score: ScoreResult | null; review_reasons: string[] }[]>`SELECT candidate, status, score, review_reasons FROM rp.evaluation_run WHERE id = ${run.id}`;
  if (!['coaching', 'review_required', 'report_partial'].includes(full.status)) return;
  const provisional = full.status === 'review_required';
  const targets = s.retry_scope?.target_check_ids ?? [];
  const input = buildCoachInput(bundle, full.candidate, run.mode, targets, retryOptions(bundle));
  const template = await promptContent(s.prompt_versions.coach.id);
  let coach = null as ReturnType<typeof validateCoaching> | null;
  const attempts: unknown[] = [];
  try {
    await spendProviderBudget(s.tenant_id);
    for (let i = 0; i < 2 && !(coach?.ok); i++) {
      const res = await completeWithRetry({ task: 'coach', template: template.content, data: input as never, schema: coachingCandidateSchema, temperature: 0.3, maxTokens: 4000, correlation: { tenant_id: s.tenant_id, session_id: s.id, evaluation_id: run.id } });
      coach = validateCoaching(res.text, full.candidate.evidence, snap.content);
      attempts.push({ ok: coach.ok, errors: coach.ok ? [] : coach.errors, provider: res.provider, model: res.model, request_id: res.request_id });
    }
  } catch (e) {
    attempts.push({ ok: false, errors: [`provider: ${(e as Error).message.slice(0, 120)}`] });
  }
  const plans = await ensureRetryPlans(run.id, s, bundle, full.candidate, snap.content);
  const base = {
    assessment_id: run.id,
    score: full.score,
    focused_results: run.mode === 'focused' ? (await sql`SELECT focused_results FROM rp.evaluation_run WHERE id = ${run.id}`)[0].focused_results : null,
    retry_plan: plans.focused ?? plans.full,
    retry_plans: plans,
    review: provisional ? { required: true, reasons: full.review_reasons } : { required: false, reasons: [] },
    mode: run.mode,
  };
  const ok = coach?.ok ? coach.candidate : null;
  const content: CoachingReport & Record<string, unknown> = {
    ...base,
    status: provisional ? 'provisional' : ok ? 'final' : 'partial',
    strengths: ok?.strengths ?? [], improvement_areas: ok?.improvement_areas ?? [], missed_questions: ok?.missed_questions ?? [],
    risky_statements: ok?.risky_statements ?? [], best_moment: ok?.best_moment ?? null, missed_opportunity: ok?.missed_opportunity ?? null,
    ...(full.candidate.risk_flags.some((f) => f.status === 'confirmed') ? {} : { no_risk_statement: NO_RISK_TEXT }),
  };
  const reportStatus = content.status;
  const runStatus = provisional ? 'review_required' : ok ? 'reported' : 'report_partial';
  await sql.begin(async (tx) => {
    await tx`INSERT INTO rp.coaching_report (tenant_id, run_id, schema_version, status, content, generation)
             VALUES (${s.tenant_id}, ${run.id}, ${COACH_SCHEMA_VERSION}, ${reportStatus}, ${tx.json(content as never)}, ${tx.json({ attempts } as never)})
             ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, content = EXCLUDED.content, generation = EXCLUDED.generation, updated_at = now()`;
    await tx`UPDATE rp.evaluation_run SET status = ${runStatus}, completed_at = CASE WHEN ${runStatus} IN ('reported','report_partial') THEN now() ELSE completed_at END WHERE id = ${run.id}`;
    await tx`UPDATE rp.session SET state = ${runStatus}, revision = revision + 1 WHERE id = ${s.id} AND current_run_id = ${run.id}`;
    if (runStatus !== 'review_required') await enqueue(tx, s.tenant_id, 'project_analytics', `analytics:${run.id}`, { run_id: run.id });
  });
  if (!ok) await metric('coaching_partial', 1, { provisional }, s.tenant_id);
}
registerHandler('coach', processCoach, async (job) => {
  // Coaching unavailable: the verified score and evidence stay visible, labelled partial (AT23).
  const runId = String(job.payload.run_id);
  await sql`UPDATE rp.evaluation_run SET status = 'report_partial' WHERE id = ${runId} AND status = 'coaching'`;
  await sql`UPDATE rp.session SET state = 'report_partial', revision = revision + 1 WHERE current_run_id = ${runId} AND state = 'coaching'`;
});

async function ensureRetryPlans(runId: string, s: SessionRow, bundle: ScenarioBundle, c: EvaluationCandidate, turns: TranscriptTurn[]) {
  type Plan = NonNullable<CoachingReport['retry_plan']>;
  const out: { full: Plan | null; focused: Plan | null } = { full: null, focused: null };
  if (bundle.retry.full_enabled) {
    const [p] = await sql`INSERT INTO rp.retry_plan (tenant_id, run_id, session_id, mode, target_check_ids, instruction)
      VALUES (${s.tenant_id}, ${runId}, ${s.id}, 'full', '[]', ${bundle.retry.instruction}) ON CONFLICT (run_id, mode) DO UPDATE SET instruction = EXCLUDED.instruction RETURNING *`;
    out.full = { id: p.id, mode: 'full', checkpoint_after_turn_id: null, target_check_ids: [], instruction: p.instruction } as Plan;
  }
  // A focused retry is offered from full attempts only; practising a slice of a slice is not supported.
  if (bundle.retry.focused_enabled && s.retry_scope?.mode !== 'focused') {
    const riskTurns = c.risk_flags.flatMap((f) => f.evidence_ids).flatMap((id) => c.evidence.find((e) => e.id === id)?.learner_spans.map((x) => x.turn_id) ?? []);
    const targetTurns = c.evidence.filter((e) => e.check_id && bundle.retry.focused_target_check_ids.includes(e.check_id) && e.status === 'observed').flatMap((e) => e.learner_spans.map((x) => x.turn_id));
    const cp = focusedCheckpoint(turns, [...riskTurns, ...targetTurns]);
    const [p] = await sql`INSERT INTO rp.retry_plan (tenant_id, run_id, session_id, mode, checkpoint_after_turn_id, checkpoint_sequence, target_check_ids, instruction)
      VALUES (${s.tenant_id}, ${runId}, ${s.id}, 'focused', ${cp.id}, ${cp.sequence}, ${sql.json(bundle.retry.focused_target_check_ids as never)}, ${bundle.retry.instruction})
      ON CONFLICT (run_id, mode) DO UPDATE SET instruction = EXCLUDED.instruction RETURNING *`;
    out.focused = { id: p.id, mode: 'focused', checkpoint_after_turn_id: p.checkpoint_after_turn_id, target_check_ids: p.target_check_ids, instruction: p.instruction } as Plan;
  }
  return out;
}

// ---- analytics projection (idempotent on run_id) ------------------------------

async function projectAnalytics(job: Job) {
  const runId = String(job.payload.run_id);
  const [r] = await sql`
    SELECT r.*, s.learner_id, s.scenario_id, s.scenario_version, s.rubric_version, s.scoring_version, s.parent_session_id, s.is_preview, s.completed_at AS s_completed
      FROM rp.evaluation_run r JOIN rp.session s ON s.id = r.session_id WHERE r.id = ${runId}`;
  if (!r || r.is_preview) return;   // preview sessions never reach production metrics
  const findings = await sql<{ status: string; reviewer_decision: string | null }[]>`SELECT status, reviewer_decision FROM rp.risk_finding WHERE run_id = ${runId}`;
  const dims = await sql<{ dimension_id: string; score: number }[]>`SELECT dimension_id, score FROM rp.dimension_score WHERE run_id = ${runId}`;
  const cand = r.candidate as EvaluationCandidate;
  const checks = Object.fromEntries(cand.evidence.filter((e) => e.check_id).map((e) => [e.check_id, e.status]));
  const score = r.score as ScoreResult | null;
  await sql`
    INSERT INTO rp.analytics_fact (run_id, tenant_id, session_id, learner_id, scenario_id, scenario_version, rubric_version, scoring_version, mode, parent_session_id,
      raw_total, raw_max, final_percent, band_id, dimension_scores, check_results, confirmed_risk, pending_review, status, completed_at)
    VALUES (${runId}, ${r.tenant_id}, ${r.session_id}, ${r.learner_id}, ${r.scenario_id}, ${r.scenario_version}, ${r.rubric_version}, ${r.scoring_version}, ${r.mode}, ${r.parent_session_id},
      ${score?.raw_total ?? null}, ${score?.raw_max ?? null}, ${score?.final_percent ?? null}, ${score?.band_id ?? null},
      ${sql.json(Object.fromEntries(dims.map((d) => [d.dimension_id, d.score])) as never)}, ${sql.json(checks as never)},
      ${findings.some((f) => f.status === 'confirmed' && f.reviewer_decision !== 'dismissed')}, ${findings.some((f) => f.status === 'uncertain' && !f.reviewer_decision)},
      ${r.status}, ${r.s_completed ?? new Date()})
    ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, raw_total = EXCLUDED.raw_total, final_percent = EXCLUDED.final_percent, band_id = EXCLUDED.band_id,
      confirmed_risk = EXCLUDED.confirmed_risk, pending_review = EXCLUDED.pending_review, dimension_scores = EXCLUDED.dimension_scores`;
}
registerHandler('project_analytics', projectAnalytics);

// ---- reads: report --------------------------------------------------------------

export async function getReport(actor: Actor, sessionId: string) {
  const s = await loadSessionFor(actor, sessionId, 'owner_or_manager');
  if (!s.current_run_id) {
    if (s.state === 'active') throw conflict('NOT_FINISHED', 'Finish the practice to get a report.');
    throw notFound('Report');
  }
  const [run] = await sql<{ id: string; status: string; mode: string; score: ScoreResult | null; review_reasons: string[]; error: unknown }[]>`SELECT id, status, mode, score, review_reasons, error FROM rp.evaluation_run WHERE id = ${s.current_run_id}`;
  const [rep] = await sql<{ status: string; content: CoachingReport }[]>`SELECT status, content FROM rp.coaching_report WHERE run_id = ${run.id}`;
  const processing = ['queued', 'evaluating', 'coaching'].includes(run.status) && !rep;
  if (processing) return { status: 202 as const, body: { session_id: s.id, state: run.status, message: 'Your conversation is being assessed.' } };
  if (run.status === 'evaluation_failed') return { status: 200 as const, body: { session_id: s.id, state: run.status, error: run.error, report: null } };
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  const [dims, evidence, risks, turns] = await Promise.all([
    sql`SELECT dimension_id, score, anchor_score, evidence_ids, rationale, status FROM rp.dimension_score WHERE run_id = ${run.id} ORDER BY dimension_id`,
    sql`SELECT id, check_id, category, status, learner_spans, context_spans, explanation, method, confidence FROM rp.evidence WHERE run_id = ${run.id}`,
    sql`SELECT rule_id, status, evidence_ids, severity, consequence, reviewer_decision FROM rp.risk_finding WHERE run_id = ${run.id}`,
    sql`SELECT t.id AS turn_id, t.sequence, t.speaker, t.text, t.origin, COALESCE(i.mode, 'text') AS input_mode, i.edited AS asr_edited FROM rp.turn t LEFT JOIN rp.turn_input i ON i.turn_id = t.id WHERE t.session_id = ${s.id} ORDER BY t.sequence`,
  ]);
  const dimOrder = bundle.rubric.dimensions.map((d) => d.id);
  return {
    status: 200 as const,
    body: {
      session_id: s.id, state: run.status, mode: run.mode, scenario: { id: bundle.scenario.id, version: s.scenario_version, title: bundle.scenario.title },
      pinned: { bundle_hash: s.bundle_hash, rubric_version: s.rubric_version, scoring_version: s.scoring_version, transcript_hash: s.transcript_hash },
      comparable: s.retry_scope?.comparable ?? true,
      report: rep?.content ?? null, report_status: rep?.status ?? null,
      dimensions: [...dims].sort((a, b) => dimOrder.indexOf(a.dimension_id) - dimOrder.indexOf(b.dimension_id)).map((d) => {
        const def = bundle.rubric.dimensions.find((x) => x.id === d.dimension_id)!;
        return { ...d, name: def.name, max_score: def.max_score, anchor: def.anchors.find((a) => a.score === d.score) };
      }),
      evidence, risk_findings: risks.map((r) => ({ ...r, description: bundle.risk_policy.rules.find((x) => x.id === r.rule_id)?.description })),
      checks: bundle.rubric.checks.map((c) => ({ id: c.id, description: c.description, category: c.category })),
      transcript: turns,
      review_reasons: run.review_reasons,
    },
  };
}

// ---- review (spec §18 POST /evaluations/{id}/reviews) -----------------------------

export interface ReviewInput {
  decisions: { rule_id: string; decision: 'upheld' | 'dismissed'; note?: string }[];
  dimension_overrides?: { dimension_id: string; score: number; reason: string }[];
  rationale: string;
}

export async function listReviewQueue(actor: Actor) {
  requireRole(actor, 'reviewer');
  return sql`
    SELECT r.id, r.session_id, r.review_reasons, r.score->>'raw_total' AS raw_total, r.score->>'band_label' AS band_label, r.created_at,
           s.scenario_id, s.scenario_version, u.display_name AS learner
      FROM rp.evaluation_run r JOIN rp.session s ON s.id = r.session_id JOIN rp.app_user u ON u.id = s.learner_id
     WHERE r.tenant_id = ${actor.tenant_id} AND r.status = 'review_required' ORDER BY r.created_at`;
}

export async function submitReview(actor: Actor, runId: string, input: ReviewInput) {
  requireRole(actor, 'reviewer');
  if (!input?.rationale?.trim()) throw new ApiError(422, 'RATIONALE_REQUIRED', 'Explain the review decision.');
  const [run] = await sql<{ id: string; session_id: string; status: string; candidate: EvaluationCandidate; score: ScoreResult }[]>`SELECT * FROM rp.evaluation_run WHERE id = ${runId} AND tenant_id = ${actor.tenant_id}`;
  if (!run) throw notFound('Evaluation');
  if (run.status !== 'review_required') throw conflict('NOT_IN_REVIEW', 'This evaluation is not awaiting review.');
  const [s] = await sql<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${run.session_id}`;
  if (s.learner_id === actor.user_id) throw forbidden('You cannot review your own practice.');
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  const findings = await sql<{ rule_id: string }[]>`SELECT rule_id FROM rp.risk_finding WHERE run_id = ${runId}`;
  for (const d of input.decisions ?? []) if (!findings.some((f) => f.rule_id === d.rule_id)) throw new ApiError(422, 'UNKNOWN_FINDING', `No finding for rule ${d.rule_id}.`);
  const dismissed = new Set((input.decisions ?? []).filter((d) => d.decision === 'dismissed').map((d) => d.rule_id));
  // Overrides keep the original: the candidate is untouched, the revised score is stored beside it.
  const scores = run.candidate.dimension_scores.map((d) => {
    const o = input.dimension_overrides?.find((x) => x.dimension_id === d.dimension_id);
    if (o && !o.reason?.trim()) throw new ApiError(422, 'REASON_REQUIRED', `Give a reason for overriding ${o.dimension_id}.`);
    return { dimension_id: d.dimension_id, score: o ? o.score : d.score };
  });
  let revised: ScoreResult;
  try {
    revised = scoreAssessment(bundle.rubric, bundle.scoring, scores, { confirmedRiskRuleIds: run.candidate.risk_flags.filter((f) => f.status === 'confirmed' && !dismissed.has(f.rule_id)).map((f) => f.rule_id) });
  } catch (e) { throw new ApiError(422, 'INVALID_OVERRIDE', (e as Error).message); }
  await sql.begin(async (tx) => {
    for (const d of input.decisions ?? []) {
      await tx`UPDATE rp.risk_finding SET reviewer_decision = ${d.decision}, reviewer_id = ${actor.user_id}, reviewer_note = ${d.note ?? null}, decided_at = now() WHERE run_id = ${runId} AND rule_id = ${d.rule_id}`;
    }
    for (const o of input.dimension_overrides ?? []) {
      await tx`UPDATE rp.dimension_score SET score = ${o.score}, anchor_score = ${o.score}, rationale = ${`Reviewer override: ${o.reason}`} WHERE run_id = ${runId} AND dimension_id = ${o.dimension_id}`;
    }
    await tx`UPDATE rp.evaluation_run SET status = 'coaching', score = ${tx.json(revised as never)},
                    review_reasons = review_reasons || ${tx.json([{ resolved_by: actor.user_id, rationale: input.rationale, original_score: run.score, decisions: input.decisions, overrides: input.dimension_overrides ?? [] }] as never)}
              WHERE id = ${runId}`;
    await tx`UPDATE rp.session SET state = 'coaching', revision = revision + 1 WHERE id = ${s.id} AND current_run_id = ${runId}`;
    await enqueue(tx, s.tenant_id, 'coach', `coach:${runId}:final:${Date.now()}`, { run_id: runId });
    await audit(actor, 'evaluation.reviewed', 'evaluation_run', runId, { decisions: input.decisions, overrides: input.dimension_overrides ?? [], rationale: input.rationale, original: run.score?.raw_total, revised: revised.raw_total }, {}, tx as never);
  });
  return { run_id: runId, status: 'coaching', score: revised };
}

/** Authorised re-run of a failed assessment on the same snapshot (spec §19). */
export async function retryEvaluation(actor: Actor, runId: string) {
  requireRole(actor, 'reviewer', 'tenant_admin');
  const [run] = await sql<{ id: string; session_id: string; status: string; dedupe_key: string; attempt: number; snapshot_id: string; mode: string; prompt_versions: unknown }[]>`SELECT * FROM rp.evaluation_run WHERE id = ${runId} AND tenant_id = ${actor.tenant_id}`;
  if (!run) throw notFound('Evaluation');
  if (run.status !== 'evaluation_failed') throw conflict('NOT_RETRYABLE', 'Only a failed evaluation can be retried.');
  return sql.begin(async (tx) => {
    const [n] = await tx<{ id: string }[]>`
      INSERT INTO rp.evaluation_run (tenant_id, session_id, snapshot_id, mode, dedupe_key, attempt, status, evaluator_version, prompt_versions)
      VALUES (${actor.tenant_id}, ${run.session_id}, ${run.snapshot_id}, ${run.mode}, ${run.dedupe_key}, ${run.attempt + 1}, 'queued', ${EVALUATOR_VERSION}, ${tx.json(run.prompt_versions as never)}) RETURNING id`;
    const [op] = await tx<{ id: string }[]>`INSERT INTO rp.operation (tenant_id, session_id, kind, status, run_id) VALUES (${actor.tenant_id}, ${run.session_id}, 'evaluation', 'pending', ${n.id}) RETURNING id`;
    await tx`UPDATE rp.session SET state = 'evaluating', current_run_id = ${n.id}, revision = revision + 1 WHERE id = ${run.session_id}`;
    await enqueue(tx, actor.tenant_id, 'evaluate', `evaluate:${n.id}`, { run_id: n.id, operation_id: op.id });
    await audit(actor, 'evaluation.retried', 'evaluation_run', n.id, { previous_run: runId }, {}, tx as never);
    return { run_id: n.id, operation_id: op.id };
  });
}

// ---- retries (spec §20) -----------------------------------------------------------

export interface RetryInput { mode: 'full' | 'focused'; retry_plan_id: string; expected_assessment_id: string; scenario_version?: string }

export async function startRetry(actor: Actor, sessionId: string, input: RetryInput) {
  const parent = await loadSessionFor(actor, sessionId);
  if (!['reported', 'report_partial'].includes(parent.state)) throw conflict('NO_ASSESSMENT', 'A retry needs a completed report.');
  if (parent.current_run_id !== input.expected_assessment_id) throw conflict('STALE_ASSESSMENT', 'The report changed; reload it before retrying.', { current_assessment_id: parent.current_run_id });
  const [plan] = await sql<{ id: string; mode: string; checkpoint_sequence: number | null; target_check_ids: string[]; run_id: string }[]>`
    SELECT * FROM rp.retry_plan WHERE id = ${input.retry_plan_id} AND run_id = ${parent.current_run_id} AND tenant_id = ${actor.tenant_id}`;
  if (!plan || plan.mode !== input.mode) throw notFound('Retry plan');
  let versionId = parent.scenario_version_id;
  let comparable = true;
  if (input.scenario_version && input.scenario_version !== parent.scenario_version) {
    if (input.mode === 'focused') throw new ApiError(422, 'FOCUSED_PINS_PARENT', 'A focused retry continues the original conversation, so it must use the same version.');
    const [v] = await sql<{ id: string }[]>`SELECT id FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${parent.scenario_id} AND version = ${input.scenario_version} AND status = 'published' AND NOT preview_only`;
    if (!v) throw notFound('Scenario version');
    versionId = v.id; comparable = false;   // results on another version are labelled non-comparable
  }
  const scope: RetryScope = { mode: input.mode, plan_id: plan.id, parent_run_id: plan.run_id, checkpoint_sequence: plan.checkpoint_sequence, target_check_ids: plan.target_check_ids, comparable };
  const prefix = input.mode === 'focused'
    ? (await sql<TranscriptTurn[]>`SELECT id, sequence, speaker, text, origin FROM rp.turn WHERE session_id = ${parent.id} AND sequence <= ${plan.checkpoint_sequence ?? 0} ORDER BY sequence`)
    : undefined;
  return startSession(actor, { scenario_id: parent.scenario_id }, { session_id: parent.id, scope, prefix, version_id: versionId });
}

export { idempotent };
