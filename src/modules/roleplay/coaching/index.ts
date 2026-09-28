import Ajv from 'ajv';
import type { CoachingCandidate, Evidence, EvaluationCandidate, ScenarioBundle, TranscriptTurn, Finding } from '../contracts/types';
import { coachingCandidateSchema } from '../contracts/schemas';
import { runtimeOf } from '../config/runtime-extension';
import type { CoachInput } from './mock-coach';

/**
 * Coaching (spec §20).
 *
 * The coach may only rephrase verified findings. Its output is rejected if a
 * finding cites evidence the assessment does not contain, if it quotes words
 * the learner never said, or if it offers more than three priority actions.
 */

export const COACH_SCHEMA_VERSION = 'coaching-report-1.0';
export const NO_RISK_TEXT = 'No configured risk detected in this transcript.';
const ajv = new Ajv({ allErrors: true, strict: false });
const checkShape = ajv.compile(coachingCandidateSchema);

export function buildCoachInput(bundle: ScenarioBundle, candidate: EvaluationCandidate, mode: 'full' | 'focused', targetCheckIds: string[], retryOptions: unknown): CoachInput {
  const rt = runtimeOf(bundle);
  const exampleFor = (intentIds: string[]) => {
    for (const id of intentIds) {
      const ex = bundle.conversation.intents.find((i) => i.id === id)?.positive_examples[0];
      if (ex) return ex;
    }
    return null;
  };
  return {
    assessment_json: {
      mode,
      target_check_ids: targetCheckIds,
      dimensions: candidate.dimension_scores.map((d) => {
        const def = bundle.rubric.dimensions.find((x) => x.id === d.dimension_id)!;
        return { id: d.dimension_id, name: def.name, score: d.score, max: def.max_score, rationale: d.rationale, anchor: def.anchors.find((a) => a.score === d.score)?.description ?? '', evidence_ids: d.evidence_ids };
      }),
      evidence: candidate.evidence,
      checks: bundle.rubric.checks.map((c) => ({ id: c.id, description: c.description, category: c.category, suggested_question: exampleFor(c.accepted_intents), absence: c.id in rt.absence_checks })),
      risk_flags: candidate.risk_flags.filter((f) => f.status === 'confirmed').map((f) => ({ rule_id: f.rule_id, description: bundle.risk_policy.rules.find((r) => r.id === f.rule_id)?.description ?? f.rule_id, evidence_ids: f.evidence_ids })),
    },
    retry_options_json: retryOptions,
  };
}

export function validateCoaching(raw: string, evidence: Evidence[], turns: TranscriptTurn[]): { ok: true; candidate: CoachingCandidate } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, errors: ['Output is not valid JSON.'] }; }
  if (!checkShape(parsed)) return { ok: false, errors: (checkShape.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
  const c = parsed as unknown as CoachingCandidate;
  const ids = new Set(evidence.map((e) => e.id));
  const learnerText = turns.filter((t) => t.speaker === 'learner').map((t) => t.text).join('\n');
  const errors: string[] = [];
  const all: [string, Finding][] = [
    ...c.strengths.map((f, i) => [`strengths[${i}]`, f] as [string, Finding]),
    ...c.improvement_areas.map((f, i) => [`improvement_areas[${i}]`, f] as [string, Finding]),
    ...c.missed_questions.map((f, i) => [`missed_questions[${i}]`, f] as [string, Finding]),
    ...c.risky_statements.map((f, i) => [`risky_statements[${i}]`, f] as [string, Finding]),
    ...(c.best_moment ? [['best_moment', c.best_moment] as [string, Finding]] : []),
    ...(c.missed_opportunity ? [['missed_opportunity', c.missed_opportunity] as [string, Finding]] : []),
  ];
  for (const [w, f] of all) {
    if (!f.evidence_ids.length) errors.push(`${w}: every finding must cite verified evidence.`);
    for (const id of f.evidence_ids) if (!ids.has(id)) errors.push(`${w}: cites unknown evidence "${id}".`);
    // Anything presented as the learner's words must be their words.
    for (const m of f.text.matchAll(/“([^”]+)”/g)) if (m[1] && !learnerText.includes(m[1])) errors.push(`${w}: quotes words the learner did not say.`);
  }
  if (c.improvement_areas.length > 3) errors.push('At most three priority improvements.');
  return errors.length ? { ok: false, errors } : { ok: true, candidate: c };
}

/**
 * Where a focused retry should resume: just before the earliest learner turn
 * that touched a practice target or made a risky statement, so the retry
 * starts before those opportunities (spec §20). With neither, after the first
 * third of the learner's turns. The opening is the earliest possible checkpoint.
 */
export function focusedCheckpoint(turns: TranscriptTurn[], cutBeforeTurnIds: string[]): TranscriptTurn {
  const learner = turns.filter((t) => t.speaker === 'learner');
  const first = turns.find((t) => cutBeforeTurnIds.includes(t.id));
  let cut: TranscriptTurn | undefined;
  if (first) cut = [...turns].reverse().find((t) => t.sequence < first.sequence && t.speaker === 'customer');
  else {
    const k = Math.ceil(learner.length / 3);
    const pivot = learner[k - 1];
    cut = pivot ? turns.find((t) => t.sequence === pivot.sequence + 1 && t.speaker === 'customer') : undefined;
  }
  return cut ?? turns[0];
}
