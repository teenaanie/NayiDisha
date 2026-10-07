import Ajv from 'ajv';
import { sql } from '@/lib/db';
import { ApiError, audit, logError, notFound, requireRole, type Actor } from './context';
import { loadBundle } from './sessions';
import { loadPrompt } from '../config/content';
import { sha256 } from '../config/compile';
import { runtimeOf } from '../config/runtime-extension';
import { completeWithRetry } from '../providers';
import { renderFact } from '../runtime/disclosure';
import { evidenceOutcomes } from '../coaching';
import type { ScenarioBundle } from '../contracts/types';

/**
 * AI training agent (operator menu → AI training).
 *
 * Reviews the practice sessions whose assessment finished since the last run:
 * what the AI customer said, how learner questions were understood, the
 * assessment and the coaching, plus notes from human testers. It suggests
 * improvements with exact evidence; a person accepts, edits or rejects each,
 * and approval turns the accepted ones into a build brief. It never changes a
 * scenario, prompt or score itself.
 *
 * A run is split into steps of a few sessions (one model call each) and a
 * final merge, so every unit of work fits one serverless invocation. Work
 * advances while the run page is open (it polls) and from the daily cron.
 */

export const TRAINING_PROMPTS = { review: 'trainer_review_v4', merge: 'trainer_merge_v2' } as const;
export const SESSIONS_PER_STEP = 5;
export const MAX_SESSIONS_PER_RUN = 40;
const MAX_STEP_ATTEMPTS = 3;
const LEASE_SECONDS = 290;
const ASSESSED = ['reported', 'report_partial', 'review_required', 'evaluation_failed'];

export type Area = 'customer_replies' | 'question_understanding' | 'scenario_content' | 'assessment' | 'coaching' | 'assessment_framework' | 'other';
export const AREA_LABELS: Record<Area, string> = {
  customer_replies: 'Customer replies', question_understanding: 'Question understanding', scenario_content: 'Scenario content',
  assessment: 'Scores and evidence', coaching: 'Feedback and coaching', assessment_framework: 'Assessment framework', other: 'Other',
};
/** The report's two parts: the practice conversation, and the assessment of it. */
export const AREA_GROUPS: { title: string; areas: Area[] }[] = [
  { title: 'Conversation and scenario', areas: ['customer_replies', 'question_understanding', 'scenario_content', 'other'] },
  { title: 'Assessment, feedback and framework', areas: ['assessment', 'coaching', 'assessment_framework'] },
];
const AREAS = Object.keys(AREA_LABELS) as Area[];
const VERDICTS = ['confirmed', 'partly', 'not_found', 'not_checkable'] as const;
export const VERDICT_LABELS: Record<(typeof VERDICTS)[number], string> = { confirmed: 'Confirmed', partly: 'Partly confirmed', not_found: 'Not found in these sessions', not_checkable: 'Not checkable from these sessions' };

// ---- the model's answer ------------------------------------------------------------

export const trainingOutputSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'assessment_summary', 'suggestions', 'tester_note_findings'],
  properties: {
    summary: { type: 'string' },
    assessment_summary: { type: 'string' },
    suggestions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['area', 'severity', 'title', 'observation', 'evidence', 'proposed_change', 'occurrences', 'tester_note_indexes'],
        properties: {
          area: { type: 'string', enum: AREAS },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          observation: { type: 'string' },
          evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['session_ref', 'from', 'turn', 'quote'], properties: { session_ref: { type: 'string' }, from: { type: 'string', enum: ['transcript', 'report'] }, turn: { type: 'integer' }, quote: { type: 'string' } } } },
          proposed_change: { type: 'string' },
          occurrences: { type: 'integer' },
          tester_note_indexes: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    tester_note_findings: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['note_index', 'verdict', 'explanation'],
        properties: { note_index: { type: 'integer' }, verdict: { type: 'string', enum: [...VERDICTS] }, explanation: { type: 'string' } },
      },
    },
  },
} as const;
const ajv = new Ajv({ allErrors: true, strict: false });
const checkOutput = ajv.compile(trainingOutputSchema);

export interface RawSuggestion { area: Area; severity: 'high' | 'medium' | 'low'; title: string; observation: string; evidence: { session_ref: string; from: 'transcript' | 'report'; turn: number; quote: string }[]; proposed_change: string; occurrences: number; tester_note_indexes: number[] }
export interface TrainingOutput { summary: string; assessment_summary: string; suggestions: RawSuggestion[]; tester_note_findings: { note_index: number; verdict: (typeof VERDICTS)[number]; explanation: string }[] }

// ---- what the agent sees -------------------------------------------------------------

export interface SessionDigest {
  ref: string; session_id: string; language: string; scenario_version: string; retry_of: string | null; kind: 'practice' | 'assessment';
  assessment: Record<string, unknown>; coaching: Record<string, unknown> | null;
  transcript: { turn: number; speaker: 'customer' | 'learner'; text: string; note?: string }[];
}

/** Every piece of text in the session's report, for checking quotes the agent takes from it. */
export function reportText(d: Pick<SessionDigest, 'assessment' | 'coaching'>): string {
  const out: string[] = [];
  const walk = (v: unknown) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(d.assessment); walk(d.coaching);
  return out.join('\n');
}

const METHOD: Record<string, string> = { fixture: 'fixed', generated: 'generated', mixed: 'mixed', fallback: 'fallback', configured: 'configured' };

/** Customer lines carry how they were produced: matched topics, leftover question, reply method, rejected drafts. */
function annotate(a: { intents: { intent_id: string }[]; plan: { kind?: string; parts?: { kind: string; question?: string }[] }; generation: { method?: string; attempts?: { ok: boolean; reason: string | null }[] } } | undefined): string | undefined {
  if (!a) return undefined;
  const topics = a.intents.map((i) => i.intent_id).join(',') || 'none';
  const leftover = a.plan.parts?.find((p) => p.kind === 'respond')?.question;
  const rejected = (a.generation.attempts ?? []).filter((x) => !x.ok).map((x) => x.reason).filter(Boolean);
  return [`topics=${topics}`, leftover ? `leftover="${leftover}"` : null, `reply=${METHOD[a.generation.method ?? ''] ?? a.generation.method ?? '?'}`, rejected.length ? `rejected=${rejected.join(',')}` : null].filter(Boolean).join('; ');
}

export async function sessionDigests(tenantId: string, sessionIds: string[], refStart = 1): Promise<{ digests: SessionDigest[]; bundles: Map<string, ScenarioBundle> }> {
  const bundles = new Map<string, ScenarioBundle>();
  const digests: SessionDigest[] = [];
  for (const [i, id] of sessionIds.entries()) {
    const [s] = await sql<{ id: string; language: string | null; scenario_version_id: string; bundle_hash: string; scenario_version: string; parent_session_id: string | null; kind: 'practice' | 'assessment' }[]>`
      SELECT s.id, s.language, s.scenario_version_id, sv.bundle_hash, sv.version AS scenario_version, s.parent_session_id, s.kind
      FROM rp.session s JOIN rp.scenario_version sv ON sv.id = s.scenario_version_id WHERE s.id = ${id} AND s.tenant_id = ${tenantId}`;
    if (!s) continue;
    if (!bundles.has(s.scenario_version)) bundles.set(s.scenario_version, await loadBundle(tenantId, s.scenario_version_id, s.bundle_hash));
    const bundle = bundles.get(s.scenario_version)!;
    const turns = await sql<{ id: string; sequence: number; speaker: 'customer' | 'learner'; text: string; origin: string }[]>`
      SELECT id, sequence, speaker, text, origin FROM rp.turn WHERE session_id = ${id} ORDER BY sequence`;
    const analysis = await sql<{ turn_id: string; intents: never; plan: never; generation: never }[]>`
      SELECT turn_id, intents, plan, generation FROM rp.turn_analysis WHERE session_id = ${id}`;
    const byTurn = new Map(analysis.map((a) => [a.turn_id, a]));
    const transcript: SessionDigest['transcript'] = [];
    let lastLearner: string | null = null;
    for (const t of turns) {
      const note = t.speaker === 'customer' && lastLearner ? annotate(byTurn.get(lastLearner) as never) : undefined;
      transcript.push({ turn: t.sequence, speaker: t.speaker, text: t.text, ...(t.origin === 'retry_prefix' ? { note: 'copied from the earlier attempt' } : note ? { note } : {}) });
      if (t.speaker === 'learner') lastLearner = t.origin === 'retry_prefix' ? null : t.id;
    }
    type Ev = { id: string; category: string; check_id?: string; status: string; method: string; explanation: string; learner_spans?: { turn_id: string; quote: string }[]; context_spans?: { turn_id: string; quote: string }[] };
    const [run] = await sql<{ id: string; status: string; candidate: { dimension_scores?: { dimension_id: string; score: number; rationale: string; coaching?: string; status: string; evidence_ids?: string[] }[]; risk_flags?: { rule_id: string; status: string; evidence_ids?: string[] }[]; evidence?: Ev[] } | null; score: { final_percent?: number; base_percent?: number; band_label?: string; adjustments?: { detail: string }[] } | null; review_reasons: unknown; error: unknown }[]>`
      SELECT id, status, candidate, score, review_reasons, error FROM rp.evaluation_run
      WHERE session_id = ${id} AND status <> 'superseded' ORDER BY created_at DESC LIMIT 1`;
    const dimName = new Map(bundle.rubric.dimensions.map((d) => [d.id, d.name]));
    // The evidence behind the scores: each check's outcome, with the quotes and turns it relied on.
    const seq = new Map(turns.map((t) => [t.id, t.sequence]));
    const checkDesc = new Map(bundle.rubric.checks.map((c) => [c.id, c.description]));
    const quotes = (spans?: { turn_id: string; quote: string }[]) => (spans ?? []).slice(0, 2).map((x) => ({ turn: seq.get(x.turn_id) ?? null, quote: Array.from(x.quote).slice(0, 160).join('') }));
    // The platform's own reading of each item (as the coach uses it): for a check satisfied by
    // absence ("simple language"), not_observed means no violation, i.e. met. The agent misread
    // that as a failure in three sessions (run 3059561a, 7 Oct 2026).
    const outcomes = run?.candidate?.evidence ? evidenceOutcomes(bundle, run.candidate as never) : new Map<string, string>();
    const evidence = (run?.candidate?.evidence ?? []).slice(0, 60).map((e) => ({
      id: e.id, check: e.check_id ? `${e.check_id}: ${checkDesc.get(e.check_id) ?? ''}` : e.category, status: e.status, outcome: outcomes.get(e.id) ?? null, method: e.method,
      learner_quotes: quotes(e.learner_spans), ...(e.context_spans?.length ? { context_quotes: quotes(e.context_spans) } : {}), explanation: Array.from(e.explanation ?? '').slice(0, 240).join(''),
    }));
    // A follow-up continues its first attempt; what was credited there counts here, including
    // turns after the retry point that this transcript does not contain.
    const [scope] = await sql<{ retry_scope: { mode?: string; parent_run_id?: string } | null }[]>`SELECT retry_scope FROM rp.session WHERE id = ${id}`;
    const firstAttempt = scope?.retry_scope?.mode === 'focused' && scope.retry_scope.parent_run_id
      ? (await sql<{ check_id: string; quote: string | null }[]>`SELECT check_id, learner_spans->0->>'quote' AS quote FROM rp.evidence
          WHERE run_id = ${scope.retry_scope.parent_run_id} AND check_id IS NOT NULL AND status = 'observed'`).map((x) => ({ check: `${x.check_id}: ${checkDesc.get(x.check_id) ?? ''}`, learner_said: x.quote }))
      : null;
    const assessment: Record<string, unknown> = run ? {
      status: run.status,
      ...(firstAttempt ? { follow_up_of_first_attempt: true, first_attempt_covered: firstAttempt } : {}),
      ...(run.score?.final_percent !== undefined ? { overall: `${run.score.final_percent}/100 ${run.score.band_label ?? ''}`.trim(), before_adjustments: run.score.base_percent ?? null } : {}),
      ...(run.score?.adjustments?.length ? { adjustments: run.score.adjustments.map((a) => a.detail) } : {}),
      skills: (run.candidate?.dimension_scores ?? []).map((d) => ({ skill: dimName.get(d.dimension_id) ?? d.dimension_id, weight: bundle.scoring.weights?.[d.dimension_id] ?? null, score: d.score, status: d.status, rationale: d.rationale, coaching: d.coaching ?? null, evidence_ids: d.evidence_ids ?? [] })),
      risk_flags: (run.candidate?.risk_flags ?? []).map((f) => ({ rule: f.rule_id, status: f.status, evidence_ids: f.evidence_ids ?? [] })),
      evidence,
      ...(run.review_reasons && JSON.stringify(run.review_reasons) !== '[]' ? { review_reasons: run.review_reasons } : {}),
      ...(run.error ? { error: run.error } : {}),
    } : { status: 'none' };
    type F = { text: string; suggested_question?: string | null; evidence_ids?: string[] };
    const [cr] = run ? await sql<{ status: string; content: { strengths?: F[]; improvement_areas?: F[]; missed_questions?: F[]; risky_statements?: F[]; no_risk_statement?: string; retry_plan?: { instruction?: string } | null } }[]>`
      SELECT status, content FROM rp.coaching_report WHERE run_id = ${run.id}` : [];
    const item = (f: F) => ({ text: f.text, ...(f.suggested_question ? { suggested_question: f.suggested_question } : {}), evidence_ids: f.evidence_ids ?? [] });
    const coaching = cr ? {
      status: cr.status,
      what_went_well: (cr.content.strengths ?? []).map(item),
      areas_of_improvement: (cr.content.improvement_areas ?? []).map(item),
      top_missed_questions: (cr.content.missed_questions ?? []).map(item),
      risky_statements: (cr.content.risky_statements ?? []).map(item),
      ...(cr.content.no_risk_statement ? { no_risk_statement: cr.content.no_risk_statement } : {}),
      ...(cr.content.retry_plan?.instruction ? { retry_instruction: cr.content.retry_plan.instruction } : {}),
    } : null;
    // A graded assessment has no coaching report by design; the agent should not report that as missing.
    digests.push({ ref: `S${refStart + i}`, session_id: id, language: s.language ?? 'en', scenario_version: s.scenario_version, retry_of: s.parent_session_id, kind: s.kind ?? 'practice', assessment, coaching, transcript });
  }
  return { digests, bundles };
}

/** The scenario as the agent needs it: profile, topics with fixed answers, cues, rubric and scoring. */
export function scenarioDigest(b: ScenarioBundle) {
  const rt = runtimeOf(b);
  const rules = b.conversation.rules;
  return {
    id: b.scenario.id, version: b.scenario.version, title: b.scenario.title, learner_brief: b.scenario.learner_brief,
    customer: { name: b.persona.name, role: b.persona.role, style: b.persona.speaking_style },
    profile_facts: b.facts.map((f) => ({ id: f.id, value: renderFact(f), knowledge: f.knowledge, shown: f.visibility === 'opening' ? 'in the opening line' : 'when asked' })),
    opening_line: b.conversation.opening_text,
    stock_lines: { unknown: b.conversation.unknown_response, clarification: b.conversation.clarification_response },
    topics: b.conversation.intents.map((i) => ({ id: i.id, description: i.description, example_questions: i.positive_examples, fixed_answer: rules.find((r) => r.intent_ids.includes(i.id))?.response_text ?? null })),
    volunteered_cues: rt.volunteered_cues.map((c) => ({ line: c.text, after_learner_messages: c.after_learner_turns, with_topics: c.with_intents ?? [] })),
    assessment_framework: {
      skills: b.rubric.dimensions.map((d) => {
        const g = rt.evaluation_guide?.skills.find((x) => x.dimension_id === d.id);
        return { id: d.id, skill: d.name, weight: b.scoring.weights?.[d.id] ?? null, anchors: d.anchors.map((a) => `${a.score}: ${a.description}`),
          checks: d.check_ids.map((id) => { const c = b.rubric.checks.find((x) => x.id === id); return { id, description: c?.description ?? id, category: c?.category ?? null }; }),
          ...(g ? { measures: g.measures, look_for: g.look_for, score_guidance: g.score_guidance.map((x) => `${x.score}: ${x.guidance}`) } : {}) };
      }),
      ...(rt.evaluation_guide ? {
        level_labels: rt.evaluation_guide.level_labels, discovery_framework: rt.evaluation_guide.framework, framework_note: rt.evaluation_guide.framework_note,
        cues_and_expected_follow_ups: rt.evaluation_guide.cues, acceptable_variations: rt.evaluation_guide.variations,
        exclusions: rt.evaluation_guide.exclusions, principles: rt.evaluation_guide.principles,
      } : {}),
      risk_rules: b.risk_policy.rules.map((r) => ({ id: r.id, description: r.description, severity: r.severity, consequence: r.consequence, examples: r.examples })),
      scoring: { mode: b.scoring.mode, bands: b.scoring.bands.map((x) => `${x.label}: ${x.lower}–${x.upper}`), risk_effect: b.scoring.risk_effect, risk_effect_parameters: b.scoring.risk_effect_parameters ?? null },
    },
  };
}

export function parseNotes(text: string | null | undefined): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 50);
}

// ---- checking the answer ---------------------------------------------------------------

const norm = (s: string) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

export interface CheckedEvidence { session_id: string; ref: string; turn: number | null; speaker: string; quote: string }
export interface CheckedSuggestion extends Omit<RawSuggestion, 'evidence'> { evidence: CheckedEvidence[]; source: 'agent' | 'tester_note' }

/**
 * Evidence must quote the cited turn exactly (spacing and curly quotes aside). Invalid evidence
 * is dropped; an agent suggestion left with none is dropped; a tester-note one is kept.
 */
export function verifyOutput(out: TrainingOutput, digests: SessionDigest[], noteCount: number) {
  const byRef = new Map(digests.map((d) => [d.ref, d]));
  let droppedEvidence = 0; let droppedSuggestions = 0;
  const suggestions: CheckedSuggestion[] = [];
  for (const s of out.suggestions) {
    const evidence: CheckedEvidence[] = [];
    for (const e of s.evidence) {
      const d = byRef.get(e.session_ref.trim());
      if (!d || norm(e.quote).length < 3) { droppedEvidence++; continue; }
      if (e.from === 'report') {
        // A quote from the assessment report (a rationale, a coaching line, a missed question).
        if (!norm(reportText(d)).includes(norm(e.quote))) { droppedEvidence++; continue; }
        if (evidence.length < 4) evidence.push({ session_id: d.session_id, ref: d.ref, turn: null, speaker: 'report', quote: e.quote.trim() });
        continue;
      }
      const t = d.transcript.find((x) => x.turn === e.turn);
      if (!t || !norm(t.text).includes(norm(e.quote))) { droppedEvidence++; continue; }
      if (evidence.length < 4) evidence.push({ session_id: d.session_id, ref: d.ref, turn: t.turn, speaker: t.speaker, quote: e.quote.trim() });
    }
    const notes = Array.from(new Set(s.tester_note_indexes.filter((n) => n >= 0 && n < noteCount)));
    if (!evidence.length && !notes.length) { droppedSuggestions++; continue; }
    if (!s.title.trim() || !s.proposed_change.trim()) { droppedSuggestions++; continue; }
    suggestions.push({ ...s, title: s.title.trim(), observation: s.observation.trim(), proposed_change: s.proposed_change.trim(), evidence, tester_note_indexes: notes, occurrences: Math.max(1, s.occurrences || evidence.length || 1), source: notes.length ? 'tester_note' : 'agent' });
  }
  const findings = new Map<number, TrainingOutput['tester_note_findings'][number]>();
  for (const f of out.tester_note_findings) if (f.note_index >= 0 && f.note_index < noteCount && !findings.has(f.note_index)) findings.set(f.note_index, f);
  return { summary: out.summary.trim(), assessment_summary: (out.assessment_summary ?? '').trim(), suggestions, tester_note_findings: [...findings.values()].sort((a, b) => a.note_index - b.note_index), dropped: { evidence: droppedEvidence, suggestions: droppedSuggestions } };
}

function parseOutput(text: string): TrainingOutput {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('The training agent returned invalid JSON.'); }
  if (!checkOutput(parsed)) throw new Error(`The training agent's answer failed its schema: ${ajv.errorsText(checkOutput.errors).slice(0, 200)}`);
  return parsed as TrainingOutput;
}

// ---- runs ------------------------------------------------------------------------------

interface Step { refs: string[]; session_ids: string[]; status: 'pending' | 'done' | 'failed'; attempts: number; output?: ReturnType<typeof verifyOutput>; error?: string; model?: string }
interface RunRow {
  id: string; tenant_id: string; trigger: 'manual' | 'weekly'; period_from: Date; period_to: Date; status: 'analysing' | 'in_review' | 'approved' | 'failed';
  session_ids: string[]; sessions_skipped: number; steps: Step[]; result: Record<string, unknown> | null; tester_notes: string | null; model: string | null;
  prompt_ids: Record<string, unknown>; error: string | null; created_by: string; created_at: Date; completed_at: Date | null;
  reviewed_by: string | null; approved_at: Date | null; brief_md: string | null;
}

/** Where the next run starts: the end of the last run that did not fail. */
export async function trainingWatermark(tenantId: string): Promise<Date | null> {
  const t = await exactWatermark(tenantId);
  return t ? new Date(t) : null;
}

/**
 * The same, as the database's own text: timestamps carry microseconds, a JS Date only
 * milliseconds, so a session assessed at .331500 would otherwise fall into two runs (or none).
 */
async function exactWatermark(tenantId: string): Promise<string | null> {
  const [r] = await sql<{ to: string | null }[]>`SELECT max(period_to)::text AS to FROM rp.training_run WHERE tenant_id = ${tenantId} AND status <> 'failed'`;
  return r?.to ?? null;
}

function canTrain(actor: Actor) { requireRole(actor, 'author', 'tenant_admin'); }

export async function startTrainingRun(actor: Actor | null, tenantId: string, opts: { trigger: 'manual' | 'weekly'; notes?: string | null; from?: Date | null; createdBy?: string }) {
  if (actor) canTrain(actor);
  const [busy] = await sql`SELECT 1 FROM rp.training_run WHERE tenant_id = ${tenantId} AND status = 'analysing'`;
  if (busy) throw new ApiError(409, 'TRAINING_RUN_ACTIVE', 'A training run is still in progress. Wait for it to finish first.');
  const notes = (opts.notes ?? '').trim().slice(0, 8000) || null;
  // Boundaries stay database text (microseconds) from query to storage; see exactWatermark.
  const from = opts.from ? opts.from.toISOString() : (await exactWatermark(tenantId)) ?? '1970-01-01T00:00:00Z';
  const [{ now }] = await sql<{ now: string }[]>`SELECT now()::text AS now`;
  // Oldest first, so a capped run still moves the watermark forward without gaps.
  const rows = await sql<{ session_id: string; done: string }[]>`
    SELECT session_id, done FROM (
      SELECT DISTINCT ON (er.session_id) er.session_id, er.completed_at AS at, er.completed_at::text AS done
      FROM rp.evaluation_run er JOIN rp.session s ON s.id = er.session_id
      WHERE er.tenant_id = ${tenantId} AND er.status IN ${sql(ASSESSED)} AND er.completed_at > ${from}::timestamptz AND er.completed_at <= ${now}::timestamptz AND NOT s.is_preview
      ORDER BY er.session_id, er.completed_at DESC) x
    ORDER BY at`;
  const picked = rows.slice(0, MAX_SESSIONS_PER_RUN);
  const to = rows.length > picked.length ? picked[picked.length - 1].done : now;
  const ids = picked.map((r) => r.session_id);
  const steps: Step[] = [];
  for (let i = 0; i < ids.length; i += SESSIONS_PER_STEP) {
    const chunk = ids.slice(i, i + SESSIONS_PER_STEP);
    steps.push({ refs: chunk.map((_, k) => `S${i + k + 1}`), session_ids: chunk, status: 'pending', attempts: 0 });
  }
  // Notes with no sessions still get one step: the agent records them as not checkable.
  if (!steps.length && notes) steps.push({ refs: [], session_ids: [], status: 'pending', attempts: 0 });
  const prompts = Object.fromEntries(Object.entries(TRAINING_PROMPTS).map(([k, id]) => [k, { id, digest: sha256(loadPrompt(id)).slice(0, 16) }]));
  const status = steps.length ? 'analysing' : 'in_review';
  const result = steps.length ? null : { summary: 'No practice sessions were assessed in this period, so there was nothing to review.', tester_note_findings: [], dropped: { evidence: 0, suggestions: 0 } };
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO rp.training_run (tenant_id, trigger, period_from, period_to, status, session_ids, sessions_skipped, steps, result, tester_notes, prompt_ids, created_by, completed_at)
    VALUES (${tenantId}, ${opts.trigger}, ${from}::timestamptz, ${to}::timestamptz, ${status}, ${ids}::uuid[], ${rows.length - picked.length}, ${sql.json(steps as never)}, ${result ? sql.json(result as never) : null},
            ${notes}, ${sql.json(prompts as never)}, ${opts.createdBy ?? actor?.display_name ?? 'system'}, ${status === 'in_review' ? now : null}::timestamptz)
    RETURNING id`;
  await audit(actor, 'training.run_started', 'training_run', run.id, { trigger: opts.trigger, sessions: ids.length, more_pending: rows.length - picked.length });
  return { id: run.id, sessions: ids.length, more_pending: rows.length - picked.length };
}

async function claim(runId: string): Promise<RunRow | null> {
  const [run] = await sql<RunRow[]>`
    UPDATE rp.training_run SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE id = ${runId} AND status = 'analysing' AND (lease_until IS NULL OR lease_until < now()) RETURNING *`;
  return run ?? null;
}

const correlation = (run: RunRow, op: string) => ({ tenant_id: run.tenant_id, session_id: run.id, operation_id: `training:${op}` });

async function runStep(run: RunRow, step: Step) {
  const { digests, bundles } = await sessionDigests(run.tenant_id, step.session_ids, Number(step.refs[0]?.slice(1) ?? 1));
  const notes = parseNotes(run.tester_notes);
  const res = await completeWithRetry({
    task: 'train', template: loadPrompt(TRAINING_PROMPTS.review), schema: trainingOutputSchema as never, temperature: 0.2, maxTokens: 32000,
    data: { scenario_json: [...bundles.values()].map(scenarioDigest), sessions_json: digests, tester_notes_json: notes.map((text, index) => ({ index, text })) },
    correlation: correlation(run, `step:${step.refs[0] ?? 'notes'}`),
  }, undefined, 1);
  return { output: verifyOutput(parseOutput(res.text), digests, notes.length), model: res.model };
}

async function merge(run: RunRow) {
  const outputs = run.steps.filter((s) => s.status === 'done' && s.output).map((s) => s.output!);
  const notes = parseNotes(run.tester_notes);
  const { digests } = await sessionDigests(run.tenant_id, run.session_ids);
  if (outputs.length === 1) return { ...outputs[0], merged: false };
  try {
    const res = await completeWithRetry({
      task: 'train', template: loadPrompt(TRAINING_PROMPTS.merge), schema: trainingOutputSchema as never, temperature: 0.1, maxTokens: 32000,
      data: { tester_notes_json: notes.map((text, index) => ({ index, text })), batches_json: outputs.map((o) => ({ summary: o.summary, assessment_summary: o.assessment_summary, suggestions: o.suggestions.map(asRaw), tester_note_findings: o.tester_note_findings })) },
      correlation: correlation(run, 'merge'),
    }, undefined, 2);
    return { ...verifyOutput(parseOutput(res.text), digests, notes.length), merged: true };
  } catch (e) {
    // The batches are each valid; listing them unmerged beats losing the run.
    logError('training.merge', e, { tenant_id: run.tenant_id, run_id: run.id });
    return {
      summary: outputs.map((o) => o.summary).join(' '), assessment_summary: outputs.map((o) => o.assessment_summary).filter(Boolean).join(' '), suggestions: outputs.flatMap((o) => o.suggestions),
      tester_note_findings: Array.from(new Map(outputs.flatMap((o) => o.tester_note_findings).map((f) => [f.note_index, f])).values()),
      dropped: { evidence: outputs.reduce((n, o) => n + o.dropped.evidence, 0), suggestions: outputs.reduce((n, o) => n + o.dropped.suggestions, 0) }, merged: false,
    };
  }
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Back to exactly the agent's own shape (the merge answer is checked against the same schema). */
const asRaw = (s: CheckedSuggestion): RawSuggestion => ({
  area: s.area, severity: s.severity, title: s.title, observation: s.observation, proposed_change: s.proposed_change, occurrences: s.occurrences,
  tester_note_indexes: s.tester_note_indexes, evidence: s.evidence.map((e) => ({ session_ref: e.ref, from: e.turn === null ? 'report' as const : 'transcript' as const, turn: e.turn ?? 0, quote: e.quote })),
});

async function finish(run: RunRow) {
  const out = await merge(run);
  const ordered = [...out.suggestions].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.occurrences - a.occurrences);
  const models = Array.from(new Set(run.steps.map((s) => s.model).filter(Boolean)));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM rp.training_suggestion WHERE run_id = ${run.id}`;
    for (const [i, s] of ordered.entries()) {
      await tx`INSERT INTO rp.training_suggestion (tenant_id, run_id, seq, source, area, severity, title, observation, evidence, proposed_change, occurrences, tester_note_indexes)
        VALUES (${run.tenant_id}, ${run.id}, ${i + 1}, ${s.source}, ${s.area}, ${s.severity}, ${s.title}, ${s.observation}, ${tx.json(s.evidence as never)}, ${s.proposed_change}, ${s.occurrences}, ${s.tester_note_indexes})`;
    }
    await tx`UPDATE rp.training_run SET status = 'in_review', completed_at = now(), model = ${models.join(', ') || null},
      result = ${tx.json({ summary: out.summary, assessment_summary: out.assessment_summary, tester_note_findings: out.tester_note_findings, dropped: out.dropped, merged: out.merged } as never)}
      WHERE id = ${run.id}`;
  });
}

/**
 * Do one unit of work on a run (one review step, or the final merge). Returns false when the
 * run is busy elsewhere, finished or not found. Safe to call from several places at once.
 */
export async function advanceTrainingRun(runId: string): Promise<boolean> {
  const run = await claim(runId);
  if (!run) return false;
  try {
    const i = run.steps.findIndex((s) => s.status === 'pending');
    if (i < 0) { await finish(run); return true; }
    const step = run.steps[i];
    try {
      const { output, model } = await runStep(run, step);
      run.steps[i] = { ...step, status: 'done', attempts: step.attempts + 1, output, model, error: undefined };
    } catch (e) {
      logError('training.step', e, { tenant_id: run.tenant_id, run_id: run.id, step: String(i) });
      const attempts = step.attempts + 1;
      const failed = attempts >= MAX_STEP_ATTEMPTS;
      run.steps[i] = { ...step, attempts, status: failed ? 'failed' : 'pending', error: (e as Error).message.slice(0, 300) };
      if (failed) {
        await sql`UPDATE rp.training_run SET steps = ${sql.json(run.steps as never)}, status = 'failed', completed_at = now(),
          error = ${`Sessions ${step.refs.join(', ') || '(notes)'} could not be reviewed after ${attempts} attempts: ${(e as Error).message.slice(0, 200)}`} WHERE id = ${run.id}`;
        return true;
      }
    }
    await sql`UPDATE rp.training_run SET steps = ${sql.json(run.steps as never)} WHERE id = ${run.id}`;
    return true;
  } catch (e) {
    logError('training.advance', e, { tenant_id: run.tenant_id, run_id: run.id });
    await sql`UPDATE rp.training_run SET status = 'failed', completed_at = now(), error = ${(e as Error).message.slice(0, 300)} WHERE id = ${run.id}`;
    return true;
  } finally {
    await sql`UPDATE rp.training_run SET lease_until = NULL WHERE id = ${runId}`;
  }
}

/** Advance runs in progress until the budget is used; a unit already started always finishes. */
export async function advanceTrainingRuns(opts: { tenantId?: string; runId?: string; budgetMs?: number } = {}) {
  const until = Date.now() + (opts.budgetMs ?? 20000);
  let units = 0;
  while (Date.now() < until) {
    const runs = await sql<{ id: string }[]>`SELECT id FROM rp.training_run WHERE status = 'analysing'
      ${opts.runId ? sql`AND id = ${opts.runId}` : sql``} ${opts.tenantId ? sql`AND tenant_id = ${opts.tenantId}` : sql``} ORDER BY created_at`;
    let progressed = false;
    for (const r of runs) if (Date.now() < until && (await advanceTrainingRun(r.id))) { progressed = true; units++; }
    if (!progressed) break;
  }
  return units;
}

/** Daily cron: on Mondays start the weekly run for each tenant with practice sessions, then advance work in progress. */
export async function trainingCronTick(now = new Date(), budgetMs = 20000) {
  const started: string[] = [];
  if (now.getUTCDay() === 1) {
    const tenants = await sql<{ id: string }[]>`SELECT DISTINCT tenant_id AS id FROM rp.session`;
    for (const t of tenants) {
      const [recent] = await sql`SELECT 1 FROM rp.training_run WHERE tenant_id = ${t.id} AND trigger = 'weekly' AND created_at > ${new Date(+now - 6 * 86400000)}`;
      const [busy] = await sql`SELECT 1 FROM rp.training_run WHERE tenant_id = ${t.id} AND status = 'analysing'`;
      if (recent || busy) continue;
      const r = await startTrainingRun(null, t.id, { trigger: 'weekly', createdBy: 'Weekly schedule' });
      started.push(r.id);
    }
  }
  const units = await advanceTrainingRuns({ budgetMs });
  return { started, units };
}

// ---- reading and reviewing ------------------------------------------------------------------

export async function listTrainingRuns(actor: Actor, limit = 50) {
  canTrain(actor);
  const runs = await sql<(RunRow & { suggestions: number; accepted: number; rejected: number })[]>`
    SELECT r.*, (SELECT count(*)::int FROM rp.training_suggestion x WHERE x.run_id = r.id) AS suggestions,
      (SELECT count(*)::int FROM rp.training_suggestion x WHERE x.run_id = r.id AND x.status = 'accepted') AS accepted,
      (SELECT count(*)::int FROM rp.training_suggestion x WHERE x.run_id = r.id AND x.status = 'rejected') AS rejected
    FROM rp.training_run r WHERE r.tenant_id = ${actor.tenant_id} ORDER BY r.created_at DESC LIMIT ${limit}`;
  return { runs, watermark: await trainingWatermark(actor.tenant_id) };
}

export interface SuggestionRow {
  id: string; seq: number; source: 'agent' | 'tester_note'; area: Area; severity: 'high' | 'medium' | 'low'; title: string; observation: string;
  evidence: CheckedEvidence[]; proposed_change: string; occurrences: number; tester_note_indexes: number[];
  status: 'pending' | 'accepted' | 'rejected'; edited_change: string | null; reviewer_note: string | null; reviewed_by: string | null; reviewed_at: Date | null;
}

export async function getTrainingRun(actor: Actor, runId: string) {
  canTrain(actor);
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw notFound('Training run');
  const [run] = await sql<RunRow[]>`SELECT * FROM rp.training_run WHERE id = ${runId} AND tenant_id = ${actor.tenant_id}`;
  if (!run) throw notFound('Training run');
  const suggestions = await sql<SuggestionRow[]>`SELECT * FROM rp.training_suggestion WHERE run_id = ${runId} ORDER BY seq`;
  return { run, suggestions, notes: parseNotes(run.tester_notes) };
}

export async function reviewSuggestion(actor: Actor, suggestionId: string, input: { status: 'pending' | 'accepted' | 'rejected'; edited_change?: string | null; reviewer_note?: string | null }) {
  canTrain(actor);
  if (!['pending', 'accepted', 'rejected'].includes(input.status)) throw new ApiError(400, 'BAD_STATUS', 'Status must be pending, accepted or rejected.');
  const [s] = await sql<{ run_id: string; proposed_change: string; run_status: string }[]>`
    SELECT x.run_id, x.proposed_change, r.status AS run_status FROM rp.training_suggestion x JOIN rp.training_run r ON r.id = x.run_id
    WHERE x.id = ${suggestionId} AND x.tenant_id = ${actor.tenant_id}`;
  if (!s) throw notFound('Suggestion');
  if (s.run_status !== 'in_review') throw new ApiError(409, 'RUN_NOT_IN_REVIEW', 'This run is not open for review.');
  const edited = (input.edited_change ?? '').trim();
  await sql`UPDATE rp.training_suggestion SET status = ${input.status},
    edited_change = ${edited && edited !== s.proposed_change.trim() ? edited.slice(0, 8000) : null},
    reviewer_note = ${(input.reviewer_note ?? '').trim().slice(0, 4000) || null}, reviewed_by = ${actor.display_name}, reviewed_at = now()
    WHERE id = ${suggestionId}`;
  await audit(actor, 'training.suggestion_reviewed', 'training_suggestion', suggestionId, { status: input.status, edited: !!edited });
}

export async function approveTrainingRun(actor: Actor, runId: string) {
  const { run, suggestions, notes } = await getTrainingRun(actor, runId);
  if (run.status !== 'in_review') throw new ApiError(409, 'RUN_NOT_IN_REVIEW', 'Only a run in review can be approved.');
  const pending = suggestions.filter((s) => s.status === 'pending').length;
  if (pending) throw new ApiError(409, 'SUGGESTIONS_PENDING', `${pending} suggestion${pending === 1 ? ' is' : 's are'} still waiting for a decision.`);
  const brief = buildBrief({ ...run, reviewed_by: actor.display_name, approved_at: new Date() }, suggestions, notes);
  await sql`UPDATE rp.training_run SET status = 'approved', reviewed_by = ${actor.display_name}, approved_at = now(), brief_md = ${brief} WHERE id = ${runId}`;
  await audit(actor, 'training.run_approved', 'training_run', runId, { accepted: suggestions.filter((s) => s.status === 'accepted').length });
  return brief;
}

/** A failed run can be retried: failed steps go back to pending. */
export async function retryTrainingRun(actor: Actor, runId: string) {
  const { run } = await getTrainingRun(actor, runId);
  if (run.status !== 'failed') throw new ApiError(409, 'RUN_NOT_FAILED', 'Only a failed run can be retried.');
  const [busy] = await sql`SELECT 1 FROM rp.training_run WHERE tenant_id = ${actor.tenant_id} AND status = 'analysing'`;
  if (busy) throw new ApiError(409, 'TRAINING_RUN_ACTIVE', 'Another training run is in progress.');
  const steps = run.steps.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' as const, attempts: 0 } : s));
  await sql`UPDATE rp.training_run SET status = 'analysing', steps = ${sql.json(steps as never)}, error = NULL, completed_at = NULL WHERE id = ${runId}`;
}

// ---- the build brief -------------------------------------------------------------------------

const fmtDate = (d: Date | string) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export function buildBrief(run: Pick<RunRow, 'id' | 'period_from' | 'period_to' | 'session_ids' | 'result' | 'reviewed_by' | 'approved_at' | 'model' | 'trigger'>, suggestions: SuggestionRow[], notes: string[]): string {
  const accepted = suggestions.filter((s) => s.status === 'accepted');
  const rejected = suggestions.filter((s) => s.status === 'rejected');
  const findings = ((run.result?.tester_note_findings ?? []) as TrainingOutput['tester_note_findings']);
  const L: string[] = [];
  L.push('# Build brief: Practice coach improvements', '');
  L.push(`- **Training run:** ${run.id} (${run.trigger === 'weekly' ? 'weekly schedule' : 'manual'})`);
  L.push(`- **Reports assessed:** ${run.period_from.getTime() === 0 ? 'from the beginning' : fmtDate(run.period_from)} to ${fmtDate(run.period_to)} · ${run.session_ids.length} session${run.session_ids.length === 1 ? '' : 's'}`);
  L.push(`- **Reviewed by:** ${run.reviewed_by ?? '—'}${run.approved_at ? ` on ${fmtDate(run.approved_at)}` : ''}`);
  if (run.model) L.push(`- **Analysis model:** ${run.model}`);
  L.push('', '## Summary', '', String(run.result?.summary ?? ''), '');
  if (run.result?.assessment_summary) L.push('## Assessment and coaching review', '', String(run.result.assessment_summary), '');
  L.push(`## Changes to build (${accepted.length})`, '');
  if (!accepted.length) L.push('No suggestions were accepted.', '');
  let n = 0;
  for (const group of AREA_GROUPS) {
    const items = accepted.filter((s) => group.areas.includes(s.area));
    if (!items.length) continue;
    L.push(`### ${group.title}`, '');
  items.forEach((s) => {
    L.push(`#### ${++n}. ${s.title}`, '');
    L.push(`**Area:** ${AREA_LABELS[s.area]} · **Severity:** ${s.severity} · **Seen:** ${s.occurrences} time${s.occurrences === 1 ? '' : 's'}${s.source === 'tester_note' ? ' · **From tester notes**' : ''}`, '');
    L.push(`**What we saw:** ${s.observation}`, '');
    if (s.evidence.length) {
      L.push('**Evidence:**');
      for (const e of s.evidence) L.push(e.turn === null ? `- Session \`${e.session_id.slice(0, 8)}\`, assessment report: "${e.quote}"` : `- Session \`${e.session_id.slice(0, 8)}\`, turn ${e.turn} (${e.speaker}): "${e.quote}"`);
      L.push('');
    }
    if (s.tester_note_indexes.length) L.push(`**Tester notes:** ${s.tester_note_indexes.map((n) => `"${notes[n] ?? `#${n + 1}`}"`).join('; ')}`, '');
    L.push(`**Change to make:** ${s.edited_change ?? s.proposed_change}`, '');
    if (s.edited_change) L.push(`_Edited by the reviewer. The agent proposed: ${s.proposed_change}_`, '');
    if (s.reviewer_note) L.push(`**Reviewer note:** ${s.reviewer_note}`, '');
  });
  }
  if (notes.length) {
    L.push('## Tester notes', '');
    notes.forEach((n, i) => {
      const f = findings.find((x) => x.note_index === i);
      L.push(`${i + 1}. "${n}": ${f ? `${VERDICT_LABELS[f.verdict]}. ${f.explanation}` : 'Not assessed.'}`);
    });
    L.push('');
  }
  if (rejected.length) {
    L.push(`## Not accepted (${rejected.length})`, '');
    for (const s of rejected) L.push(`- ${s.title}${s.reviewer_note ? `: ${s.reviewer_note}` : ''}`);
    L.push('');
  }
  L.push('## How to build', '', 'Make the changes in a new scenario or prompt version (published versions are immutable), run `npm run test:roleplay`, replay the evidence sessions with the live model, then publish with `npm run rp:seed`.');
  return L.join('\n');
}
