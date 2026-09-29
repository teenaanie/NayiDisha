import type { ScenarioBundle, TranscriptTurn, EvaluationCandidate, ScoreResult } from '../contracts/types';
import { runtimeOf } from '../config/runtime-extension';
import { computeDerivations } from '../config/patch';
import { renderFact } from '../runtime/disclosure';
import { completeWithRetry, type CompletionResult } from '../providers';
import { scoreAssessment, ScoringError } from '../scoring';
import { extractRuleEvidence, RULE_VERSION, type RuleEvidence, type RecordedIntent } from './extract';
import { validateCandidate, VALIDATOR_VERSION } from './validate';
import { evaluationCandidateSchema } from '../contracts/schemas';

/**
 * Assessment of one frozen transcript (spec §13 pipeline):
 *   rule evidence → evaluator candidate → validation (one repair) →
 *   reconciliation → deterministic score.
 * No persistence here; the evaluation worker stores every step.
 */

export const EVALUATOR_VERSION = `evaluator-1.0.0/${RULE_VERSION}/${VALIDATOR_VERSION}`;
export const REVIEW_CONFIDENCE = 0.7;

export interface AssessInput {
  bundle: ScenarioBundle;
  turns: TranscriptTurn[];
  session_id: string;
  transcript_hash: string;
  mode: 'full' | 'focused';
  target_check_ids: string[];
  template: string;
  correlation: { tenant_id: string; session_id: string; evaluation_id: string };
  /** Intents the runtime acted on per learner turn, so scoring matches what the customer understood. */
  recordedIntents?: Map<string, RecordedIntent[]>;
}
export interface ProviderOutput { attempt: number; text: string; ok: boolean; errors: string[]; /** Mechanical slips the validator normalised (see validate.ts). */ notes?: string[]; provider: string; model: string; request_id: string | null; latency_ms: number; usage: CompletionResult['usage'] }
export type AssessResult =
  | { status: 'scored'; candidate: EvaluationCandidate; rule: RuleEvidence; score: ScoreResult | null; focused: FocusedResult | null; review_reasons: string[]; outputs: ProviderOutput[] }
  | { status: 'failed'; reason: string; rule: RuleEvidence; outputs: ProviderOutput[] }
  | { status: 'unscorable'; reason: string; rule: RuleEvidence | null; outputs: ProviderOutput[] };
export interface FocusedResult { target_check_ids: string[]; checks: { check_id: string; status: string; evidence_id: string | null }[] }

export const rubricVersionOf = (b: ScenarioBundle) => `${b.rubric.id}@${b.rubric.version}`;

/** A transcript with gaps or reordering cannot be assessed; it is not a low score. */
export function transcriptIntegrity(turns: TranscriptTurn[]): string | null {
  if (!turns.length || turns[0].sequence !== 0) return 'Transcript does not start at sequence 0.';
  for (let i = 1; i < turns.length; i++) if (turns[i].sequence !== turns[i - 1].sequence + 1) return `Transcript has a gap after sequence ${turns[i - 1].sequence}.`;
  return null;
}

export async function assess(input: AssessInput): Promise<AssessResult> {
  const outputs: ProviderOutput[] = [];
  const broken = transcriptIntegrity(input.turns);
  if (broken) return { status: 'unscorable', reason: broken, rule: null, outputs };
  const { bundle } = input;
  const rule = extractRuleEvidence(bundle, input.turns, { excludeOrigins: input.mode === 'focused' ? ['retry_prefix'] : [], recordedIntents: input.recordedIntents });
  if (!rule.assessable_learner_turn_ids.length) return { status: 'unscorable', reason: 'No assessable learner turns.', rule, outputs };

  const rubricVersion = rubricVersionOf(bundle);
  const facts = bundle.facts.map((f) => ({ id: f.id, knowledge: f.knowledge, value: renderFact(f), type: f.type }));
  const data = {
    scenario_truth_json: { scenario: bundle.scenario, persona: bundle.persona, facts, derived: computeDerivations(bundle) },
    rubric_json: bundle.rubric,
    checks_json: { rule_evidence: rule.evidence, risk_candidates: rule.risk_candidates, assessable_learner_turn_ids: rule.assessable_learner_turn_ids, unexplained_jargon: rule.unexplained_jargon, runtime: runtimeOf(bundle) },
    risk_policy_json: bundle.risk_policy,
    knowledge_status_json: { pack: (bundle.extensions as { knowledge_pack?: unknown } | undefined)?.knowledge_pack ?? 'absent', product_policy_accuracy: 'not_assessed' },
    transcript_json: input.turns.map((t) => ({ turn_id: t.id, sequence: t.sequence, speaker: t.speaker, origin: t.origin, text: t.text, ...(t.input_mode === 'voice' ? { input_mode: 'voice (learner-checked transcript)' } : {}) })),
    contract_json: {
      contract_version: '1.0', session_id: input.session_id, transcript_hash: input.transcript_hash, rubric_version: rubricVersion,
      offsets: 'unicode code points, start inclusive, end exclusive',
      // Live runs (29 Sep 2026) gave score 2 with anchor_score 1 and were rejected; state the rule outright.
      dimension_score_rule: 'For each dimension choose exactly one RUBRIC anchor that best fits the evidence, and set BOTH score and anchor_score to that anchor\'s score. Never award a value between anchors or different from the chosen anchor.',
      allowed_scores: Object.fromEntries(bundle.rubric.dimensions.map((d) => [d.id, d.anchors.map((a) => a.score).sort((x, y) => x - y)])),
      previous_errors: [] as string[],
    },
  };

  let accepted: EvaluationCandidate | null = null;
  for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
    const res = await completeWithRetry({ task: 'evaluate', template: input.template, data, schema: evaluationCandidateSchema, temperature: 0, maxTokens: 12000, correlation: input.correlation });
    const v = validateCandidate(res.text, { bundle, turns: input.turns, session_id: input.session_id, transcript_hash: input.transcript_hash, rubric_version: rubricVersion, assessable_learner_turn_ids: rule.assessable_learner_turn_ids });
    outputs.push({ attempt, text: res.text, ok: v.ok, errors: v.ok ? [] : v.errors, notes: v.notes, provider: res.provider, model: res.model, request_id: res.request_id, latency_ms: res.latency_ms, usage: res.usage });
    if (v.ok) accepted = v.candidate;
    // One repair request with the same evidence snapshot, told what was wrong.
    else data.contract_json.previous_errors = v.errors.slice(0, 30);
  }
  if (!accepted) return { status: 'failed', reason: 'Evaluator output failed validation twice.', rule, outputs };

  const review = reconcile(bundle, accepted, rule);

  if (input.mode === 'focused') {
    const checks = input.target_check_ids.map((id) => {
      const ev = accepted!.evidence.find((e) => e.check_id === id);
      return { check_id: id, status: ev?.status ?? 'not_observed', evidence_id: ev?.id ?? null };
    });
    return { status: 'scored', candidate: accepted, rule, score: null, focused: { target_check_ids: input.target_check_ids, checks }, review_reasons: review, outputs };
  }

  try {
    const score = scoreAssessment(bundle.rubric, bundle.scoring,
      accepted.dimension_scores.map((d) => ({ dimension_id: d.dimension_id, score: d.score })),
      { confirmedRiskRuleIds: accepted.risk_flags.filter((f) => f.status === 'confirmed').map((f) => f.rule_id), reviewRequired: review.length > 0 });
    return { status: 'scored', candidate: accepted, rule, score, focused: null, review_reasons: review, outputs };
  } catch (e) {
    if (e instanceof ScoringError) return { status: 'failed', reason: e.message, rule, outputs };
    throw e;
  }
}

/**
 * Where the model and the rules disagree about something consequential, or a
 * consequential finding is uncertain, a person decides (spec §13, §14).
 */
export function reconcile(bundle: ScenarioBundle, c: EvaluationCandidate, rule: RuleEvidence): string[] {
  const reasons: string[] = [];
  const rules = new Map(bundle.risk_policy.rules.map((r) => [r.id, r]));
  const flagged = new Map(c.risk_flags.map((f) => [f.rule_id, f]));
  const candidates = new Set(rule.risk_candidates.map((r) => r.rule_id));
  for (const id of candidates) {
    const r = rules.get(id)!;
    if (!flagged.has(id) && r.consequence === 'review') reasons.push(`Rule found a possible "${id}" statement the evaluator did not flag.`);
  }
  for (const f of c.risk_flags) {
    const r = rules.get(f.rule_id)!;
    if (f.status === 'uncertain') reasons.push(`Evaluator is unsure about "${f.rule_id}".`);
    else if (r.consequence === 'review') reasons.push(`"${f.rule_id}" (${r.severity}) requires review by policy.`);
    if (!candidates.has(f.rule_id) && r.severity === 'high') reasons.push(`Evaluator flagged "${f.rule_id}" without a matching rule candidate.`);
  }
  for (const d of c.dimension_scores) {
    if (d.status === 'uncertain') reasons.push(`Dimension "${d.dimension_id}" is uncertain.`);
    const def = bundle.rubric.dimensions.find((x) => x.id === d.dimension_id)!;
    const highRisk = c.risk_flags.some((f) => f.status === 'confirmed' && rules.get(f.rule_id)?.severity === 'high' && rules.get(f.rule_id)!.dimension_ids.includes(d.dimension_id));
    if (highRisk && d.score > def.min_score + 1) reasons.push(`"${d.dimension_id}" scored ${d.score} despite a confirmed high-severity risk.`);
  }
  const lowConf = c.evidence.filter((e) => e.confidence < REVIEW_CONFIDENCE && (e.status === 'observed' || e.status === 'contradicted') && (e.category === 'compliance' || c.risk_flags.some((f) => f.evidence_ids.includes(e.id))));
  if (lowConf.length) reasons.push(`${lowConf.length} consequential finding(s) below confidence ${REVIEW_CONFIDENCE}.`);
  return Array.from(new Set(reasons));
}
