/**
 * JSON Schemas for the roleplay contracts (spec §8–16, §20).
 *
 * The spec's compact type notation, translated faithfully: every field is
 * required unless marked optional, and unknown fields are rejected everywhere
 * except the bundle's namespaced `extensions` object. Cross-field rules
 * (references, band coverage, anchors) cannot be expressed here and live in
 * config/compile.ts. `types.ts` mirrors these by hand; the round-trip test in
 * scripts/roleplay-tests.ts keeps them honest.
 */

const ID = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,63}$' } as const;
const SEMVER = { type: 'string', pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$' } as const;
const TEXT = { type: 'string', minLength: 1, maxLength: 4000 } as const;
const IDS = { type: 'array', items: ID, uniqueItems: true } as const;

const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
});

const money = obj({ amount_minor: { type: 'integer', minimum: 0 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' } });
const deadline = obj({ amount: { type: 'integer', minimum: 0 }, unit: { enum: ['weeks', 'days'] }, relative_to: { const: 'scenario_start' } });

export const scenarioSchema = obj({
  id: ID, version: SEMVER, title: TEXT, product: TEXT, skill: TEXT, difficulty: TEXT,
  locale: { type: 'string', pattern: '^[a-z]{2,3}(-[A-Z]{2})?$' },
  learner_role: TEXT, learner_brief: TEXT,
  target_minutes: obj({ min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } }),
  objective_ids: IDS,
  success_criteria: { type: 'array', items: TEXT },
});

export const personaSchema = obj({
  id: ID, version: SEMVER, name: TEXT, role: TEXT,
  relationships: { type: 'object', additionalProperties: { type: 'string' } },
  initial_emotion: TEXT, speaking_style: TEXT,
  concerns: { type: 'array', items: obj({ id: ID, text: TEXT, fact_refs: IDS }) },
  forbidden_inventions: { type: 'array', items: TEXT },
});

export const factSchema = {
  ...obj({
    id: ID,
    type: { enum: ['text', 'money', 'status', 'relative_deadline'] },
    value: { anyOf: [{ type: 'string', minLength: 1 }, money, deadline, { type: 'null' }] },
    knowledge: { enum: ['known', 'unknown'] },
    visibility: { enum: ['opening', 'on_intent', 'derived'] },
    release_intents: IDS,
    prerequisite_fact_ids: IDS,
    source_ref: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  }),
} as const;

export const conversationSchema = obj({
  opening_text: TEXT,
  intents: {
    type: 'array', minItems: 1,
    items: obj({ id: ID, description: TEXT, positive_examples: { type: 'array', items: TEXT }, negative_examples: { type: 'array', items: TEXT } }),
  },
  rules: {
    type: 'array',
    items: obj({
      id: ID, priority: { type: 'integer' }, intent_ids: { ...IDS, minItems: 1 },
      match: { enum: ['any', 'all'] }, reveal_fact_ids: IDS,
      response_text: TEXT, concern_id: ID,
    }, ['response_text', 'concern_id']),
  },
  unknown_response: TEXT,
  clarification_response: TEXT,
  multi_intent_mode: { const: 'answer_asked_only' },
  off_topic_mode: { const: 'brief_redirect' },
  injection_mode: { const: 'stay_in_character' },
  max_new_facts_per_turn: { type: 'integer', minimum: 1, maximum: 50 },
});

export const rubricSchema = obj({
  id: ID, version: SEMVER, title: TEXT,
  dimensions: {
    type: 'array', minItems: 1, maxItems: 30,
    items: obj({
      id: ID, name: TEXT,
      min_score: { type: 'integer', minimum: 0 }, max_score: { type: 'integer', minimum: 1 },
      anchors: { type: 'array', minItems: 1, items: obj({ score: { type: 'integer' }, description: TEXT, basis: { enum: ['source', 'recommendation'] } }) },
      check_ids: IDS,
      evaluation_method: { enum: ['rule', 'llm', 'hybrid'] },
      applicability: { enum: ['required', 'conditional'] },
      applicability_rule_id: ID,
    }, ['applicability_rule_id']),
  },
  checks: {
    type: 'array', maxItems: 500,
    items: obj({
      id: ID, description: TEXT,
      category: { enum: ['coverage', 'quality', 'compliance', 'conversation'] },
      method: { enum: ['rule', 'semantic', 'llm'] },
      accepted_intents: IDS,
      credit_requires: { enum: ['learner_question', 'learner_action'] },
      expected_fact_ids: IDS,
    }),
  },
  evidence_categories: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
});

export const riskPolicySchema = obj({
  id: ID, version: SEMVER,
  rules: {
    type: 'array',
    items: obj({
      id: ID, description: TEXT,
      category: { enum: ['selling', 'integrity', 'process'] },
      severity: { enum: ['low', 'medium', 'high'] },
      detector: { enum: ['phrase_candidate', 'semantic', 'hybrid'] },
      examples: { type: 'array', items: TEXT },
      context_exclusions: { type: 'array', items: TEXT },
      consequence: { enum: ['dimension_evidence', 'review'] },
      dimension_ids: IDS,
    }),
  },
});

export const scoringSchema = obj({
  id: ID, version: SEMVER,
  mode: { enum: ['unweighted_sum', 'weighted_percent'] },
  weights: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
  bands: {
    type: 'array', minItems: 1,
    items: obj({ id: ID, label: TEXT, lower: { type: 'number' }, upper: { type: 'number' }, upper_inclusive: { type: 'boolean' } }),
  },
  band_scale: { enum: ['raw_sum', 'percent'] },
  display_decimals: { type: 'integer', minimum: 0, maximum: 4 },
  risk_effect: { enum: ['rubric_only', 'cap', 'deduction', 'gate'] },
  risk_effect_parameters: { type: 'object' },
});

export const bundleSchema = obj({
  schema_version: { const: '1.0' },
  scenario: scenarioSchema,
  persona: personaSchema,
  facts: { type: 'array', maxItems: 200, items: factSchema },
  conversation: conversationSchema,
  rubric: rubricSchema,
  risk_policy: riskPolicySchema,
  scoring: scoringSchema,
  prompts: obj({ roleplay: ID, evaluator: ID, coach: ID }),
  retry: obj({
    full_enabled: { type: 'boolean' }, focused_enabled: { type: 'boolean' },
    focused_target_check_ids: IDS,
    focused_scoring: { const: 'checks_only' },
    instruction: TEXT,
    version_policy: { const: 'pin_parent' },
  }),
  provenance: {
    type: 'array',
    items: obj({ path: { type: 'string', pattern: '^/' }, basis: { enum: ['source', 'recommendation', 'unspecified'] }, source_ref: { type: 'string' }, note: TEXT }, ['source_ref']),
  },
  extensions: { type: 'object' },
}, ['extensions']);

// ---- model output contracts (spec §14, §15, §20) ---------------------------

const span = obj({ turn_id: { type: 'string', minLength: 1 }, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, quote: { type: 'string' } });

export const evidenceSchema = obj({
  id: ID, category: { type: 'string', minLength: 1 }, check_id: ID,
  status: { enum: ['observed', 'not_observed', 'contradicted', 'uncertain'] },
  learner_spans: { type: 'array', items: span },
  context_spans: { type: 'array', items: span },
  searched_turn_ids: { type: 'array', items: { type: 'string' } },
  explanation: { type: 'string', maxLength: 1000 },
  method: { enum: ['rule', 'semantic', 'llm', 'human'] },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  rule_version: { type: 'string' },
}, ['check_id', 'rule_version']);

const dimensionScoreItem = (coachingRequired: boolean) => obj({
  dimension_id: ID, score: { type: 'integer' }, anchor_score: { type: 'integer' },
  evidence_ids: { type: 'array', items: ID }, rationale: { type: 'string', minLength: 1, maxLength: 1000 },
  status: { enum: ['scored', 'uncertain'] },
  // Contract 1.1: one specific coaching suggestion per skill (owner's evaluator spec).
  coaching: { type: 'string', minLength: 1, maxLength: 600 },
}, coachingRequired ? [] : ['coaching']);

/** Provider totals are deliberately absent: the server computes every total. */
export const evaluationCandidateSchema = obj({
  contract_version: { enum: ['1.0', '1.1'] },
  session_id: { type: 'string' },
  transcript_hash: { type: 'string' },
  rubric_version: { type: 'string' },
  evidence: { type: 'array', items: evidenceSchema },
  dimension_scores: { type: 'array', items: dimensionScoreItem(false) },
  risk_flags: { type: 'array', items: obj({ rule_id: ID, evidence_ids: { type: 'array', items: ID }, status: { enum: ['confirmed', 'uncertain'] } }) },
});

/** The schema sent to the model for one contract version (1.1 requires per-skill coaching). */
export function evaluationCandidateSchemaFor(version: '1.0' | '1.1') {
  return { ...evaluationCandidateSchema, properties: { ...evaluationCandidateSchema.properties, contract_version: { const: version }, dimension_scores: { type: 'array', items: dimensionScoreItem(version === '1.1') } } };
}

export const roleplayCandidateSchema = obj({
  text: { type: 'string', minLength: 1, maxLength: 1200 },
  used_fact_ids: { type: 'array', items: ID },
  requested_end: { type: 'boolean' },
});

const finding = obj({ text: { type: 'string', minLength: 1, maxLength: 600 }, evidence_ids: { type: 'array', items: ID }, suggested_question: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] } });

/** What the coach model returns. Score, status and retry plan are added by the server. */
export const coachingCandidateSchema = obj({
  strengths: { type: 'array', maxItems: 6, items: finding },
  improvement_areas: { type: 'array', maxItems: 3, items: finding },
  missed_questions: { type: 'array', maxItems: 500, items: finding },
  risky_statements: { type: 'array', maxItems: 500, items: finding },
  best_moment: { anyOf: [finding, { type: 'null' }] },
  missed_opportunity: { anyOf: [finding, { type: 'null' }] },
});

export const intentClassificationSchema = obj({
  intents: { type: 'array', items: obj({ intent_id: ID, confidence: { type: 'number', minimum: 0, maximum: 1 } }) },
  is_question: { type: 'boolean' },
});
