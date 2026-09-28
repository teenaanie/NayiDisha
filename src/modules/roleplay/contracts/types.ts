/** TypeScript mirror of contracts/schemas.ts (spec §8–16, §20). */

export interface Money { amount_minor: number; currency: string }
export interface Deadline { amount: number; unit: 'weeks' | 'days'; relative_to: 'scenario_start' }
export type Basis = 'source' | 'recommendation' | 'unspecified';

export interface Scenario {
  id: string; version: string; title: string; product: string; skill: string; difficulty: string;
  locale: string; learner_role: string; learner_brief: string;
  target_minutes: { min: number; max: number };
  objective_ids: string[]; success_criteria: string[];
}
export interface Persona {
  id: string; version: string; name: string; role: string; relationships: Record<string, string>;
  initial_emotion: string; speaking_style: string;
  concerns: { id: string; text: string; fact_refs: string[] }[];
  forbidden_inventions: string[];
}
export interface Fact {
  id: string; type: 'text' | 'money' | 'status' | 'relative_deadline';
  value: string | Money | Deadline | null;
  knowledge: 'known' | 'unknown';
  visibility: 'opening' | 'on_intent' | 'derived';
  release_intents: string[]; prerequisite_fact_ids: string[]; source_ref: string | null;
}
export interface Intent { id: string; description: string; positive_examples: string[]; negative_examples: string[] }
export interface DisclosureRule {
  id: string; priority: number; intent_ids: string[]; match: 'any' | 'all';
  reveal_fact_ids: string[]; response_text?: string; concern_id?: string;
}
export interface ConversationPolicy {
  opening_text: string; intents: Intent[]; rules: DisclosureRule[];
  unknown_response: string; clarification_response: string;
  multi_intent_mode: 'answer_asked_only'; off_topic_mode: 'brief_redirect'; injection_mode: 'stay_in_character';
  max_new_facts_per_turn: number;
}
export interface Anchor { score: number; description: string; basis: 'source' | 'recommendation' }
export interface Dimension {
  id: string; name: string; min_score: number; max_score: number; anchors: Anchor[]; check_ids: string[];
  evaluation_method: 'rule' | 'llm' | 'hybrid'; applicability: 'required' | 'conditional'; applicability_rule_id?: string;
}
export interface BehaviourCheck {
  id: string; description: string; category: 'coverage' | 'quality' | 'compliance' | 'conversation';
  method: 'rule' | 'semantic' | 'llm'; accepted_intents: string[];
  credit_requires: 'learner_question' | 'learner_action'; expected_fact_ids: string[];
}
export interface Rubric { id: string; version: string; title: string; dimensions: Dimension[]; checks: BehaviourCheck[]; evidence_categories: string[] }
export interface RiskRule {
  id: string; description: string; category: 'selling' | 'integrity' | 'process'; severity: 'low' | 'medium' | 'high';
  detector: 'phrase_candidate' | 'semantic' | 'hybrid'; examples: string[]; context_exclusions: string[];
  consequence: 'dimension_evidence' | 'review'; dimension_ids: string[];
}
export interface RiskPolicy { id: string; version: string; rules: RiskRule[] }
export interface Band { id: string; label: string; lower: number; upper: number; upper_inclusive: boolean }
export interface ScoringPolicy {
  id: string; version: string; mode: 'unweighted_sum' | 'weighted_percent'; weights: Record<string, number>;
  bands: Band[]; band_scale: 'raw_sum' | 'percent'; display_decimals: number;
  risk_effect: 'rubric_only' | 'cap' | 'deduction' | 'gate'; risk_effect_parameters: Record<string, unknown>;
}
export interface RetryPolicy {
  full_enabled: boolean; focused_enabled: boolean; focused_target_check_ids: string[];
  focused_scoring: 'checks_only'; instruction: string; version_policy: 'pin_parent';
}
export interface Provenance { path: string; basis: Basis; source_ref?: string; note: string }
export interface ScenarioBundle {
  schema_version: '1.0'; scenario: Scenario; persona: Persona; facts: Fact[];
  conversation: ConversationPolicy; rubric: Rubric; risk_policy: RiskPolicy; scoring: ScoringPolicy;
  prompts: { roleplay: string; evaluator: string; coach: string };
  retry: RetryPolicy; provenance: Provenance[]; extensions?: Record<string, unknown>;
}

export interface Span { turn_id: string; start: number; end: number; quote: string }
export type EvidenceStatus = 'observed' | 'not_observed' | 'contradicted' | 'uncertain';
export interface Evidence {
  id: string; category: string; check_id?: string; status: EvidenceStatus;
  learner_spans: Span[]; context_spans: Span[]; searched_turn_ids: string[];
  explanation: string; method: 'rule' | 'semantic' | 'llm' | 'human'; confidence: number; rule_version?: string;
}
export interface DimensionScoreCandidate {
  dimension_id: string; score: number; anchor_score: number; evidence_ids: string[];
  rationale: string; status: 'scored' | 'uncertain';
}
export interface RiskFlagCandidate { rule_id: string; evidence_ids: string[]; status: 'confirmed' | 'uncertain' }
export interface EvaluationCandidate {
  contract_version: '1.0'; session_id: string; transcript_hash: string; rubric_version: string;
  evidence: Evidence[]; dimension_scores: DimensionScoreCandidate[]; risk_flags: RiskFlagCandidate[];
}
export interface RoleplayCandidate { text: string; used_fact_ids: string[]; requested_end: boolean }

export interface ScoreResult {
  mode: string; raw_total: number; raw_max: number;
  base_percent: number; final_percent: number;
  band_id: string; band_label: string;
  adjustments: { type: string; detail: string; before: number; after: number }[];
  outcome: 'complete' | 'review_required';
  /** Exact fractions behind the percents, so a replay can prove the arithmetic. */
  exact: { base_percent: string; final_percent: string };
  excluded_dimensions: { dimension_id: string; reason: string }[];
  gate?: { rule_ids: string[]; outcome: string };
}
export interface Finding { text: string; evidence_ids: string[]; suggested_question: string | null }
export interface CoachingCandidate {
  strengths: Finding[]; improvement_areas: Finding[]; missed_questions: Finding[]; risky_statements: Finding[];
  best_moment: Finding | null; missed_opportunity: Finding | null;
}
export interface CoachingReport extends CoachingCandidate {
  assessment_id: string; status: 'final' | 'provisional' | 'partial';
  score: ScoreResult | null;
  retry_plan: { id: string; mode: 'full' | 'focused'; checkpoint_after_turn_id: string | null; target_check_ids: string[]; instruction: string } | null;
  no_risk_statement?: string;
}

/** A committed transcript turn as the evaluator and runtime see it. */
export interface TranscriptTurn {
  id: string; sequence: number; speaker: 'learner' | 'customer'; text: string;
  origin: 'live' | 'opening' | 'retry_prefix';
}
