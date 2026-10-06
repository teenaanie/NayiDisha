import type { ScenarioBundle, TranscriptTurn, EvaluationCandidate, ScoreResult, Evidence, Span } from '../contracts/types';
import { englishName, type Language } from '../runtime/language';
import { runtimeOf } from '../config/runtime-extension';
import { computeDerivations } from '../config/patch';
import { renderFact } from '../runtime/disclosure';
import { completeWithRetry, type CompletionResult } from '../providers';
import { scoreAssessment, ScoringError } from '../scoring';
import { extractRuleEvidence, RULE_VERSION, type RuleEvidence, type RecordedIntent } from './extract';
import { validateCandidate, VALIDATOR_VERSION } from './validate';
import { evaluationCandidateSchemaFor } from '../contracts/schemas';

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
  /** Conversation language; quotes stay in it, explanations are written in English. */
  language?: Language;
  /** The pinned evaluator prompt ID; evaluator_v2 and later use contract 1.1 (per-skill coaching). */
  template_id?: string;
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
  const rule = extractRuleEvidence(bundle, input.turns, { excludeOrigins: input.mode === 'focused' ? ['retry_prefix'] : [], recordedIntents: input.recordedIntents, language: input.language });
  const contract = contractVersionFor(input.template_id);
  if (!rule.assessable_learner_turn_ids.length) return { status: 'unscorable', reason: 'No assessable learner turns.', rule, outputs };

  const rubricVersion = rubricVersionOf(bundle);
  // Turn IDs are UUIDs, and the evaluator copies them into every quote and search list:
  // about 40% of its output in live runs, and output length is what makes an
  // assessment slow. It sees short aliases (T<sequence>) instead; its answer is mapped
  // back to the real IDs before validation, so nothing downstream sees an alias.
  const ids = turnAliases(input.turns);
  const facts = bundle.facts.map((f) => ({ id: f.id, knowledge: f.knowledge, value: renderFact(f), type: f.type }));
  const data = {
    scenario_truth_json: { scenario: bundle.scenario, persona: bundle.persona, facts, derived: computeDerivations(bundle) },
    rubric_json: bundle.rubric,
    checks_json: {
      rule_evidence: rule.evidence.map(ids.evidenceOut), risk_candidates: rule.risk_candidates.map((r) => ({ ...r, turn_id: ids.out(r.turn_id) })),
      assessable_learner_turn_ids: rule.assessable_learner_turn_ids.map(ids.out), unexplained_jargon: rule.unexplained_jargon.map((j) => ({ ...j, turn_id: ids.out(j.turn_id) })),
      // Translations are for the customer's lines and the coach; the evaluator never needs them (≈20 KB per call).
      runtime: (({ translations, ...rest }) => rest)(runtimeOf(bundle)),
      inapplicable_check_ids: rule.inapplicable_check_ids,
    },
    // The evaluator's knowledge base (owner spec). Unused by evaluator_v1, whose template has no placeholder.
    evaluation_guide_json: evaluationGuideFor(bundle, rule, ids.out),
    risk_policy_json: bundle.risk_policy,
    knowledge_status_json: { pack: (bundle.extensions as { knowledge_pack?: unknown } | undefined)?.knowledge_pack ?? 'absent', product_policy_accuracy: 'not_assessed' },
    transcript_json: input.turns.map((t) => ({ turn_id: ids.out(t.id), sequence: t.sequence, speaker: t.speaker, origin: t.origin, text: t.text, ...(t.input_mode === 'voice' ? { input_mode: 'voice (learner-checked transcript)' } : {}) })),
    contract_json: {
      contract_version: contract, session_id: input.session_id, transcript_hash: input.transcript_hash, rubric_version: rubricVersion,
      offsets: 'unicode code points, start inclusive, end exclusive',
      conversation_language: englishName(input.language ?? 'en'),
      language_rule: (input.language ?? 'en') === 'en' ? null : `The conversation is in ${englishName(input.language ?? 'en')}. Judge it by the same rubric. Quote learner and customer words exactly as written, in their original script; write rationales and explanations in English.`,
      // Live runs (29 Sep 2026) gave score 2 with anchor_score 1 and were rejected; state the rule outright.
      dimension_score_rule: 'For each dimension choose exactly one RUBRIC anchor that best fits the evidence, and set BOTH score and anchor_score to that anchor\'s score. Never award a value between anchors or different from the chosen anchor.',
      allowed_scores: Object.fromEntries(bundle.rubric.dimensions.map((d) => [d.id, d.anchors.map((a) => a.score).sort((x, y) => x - y)])),
      // Live Hindi runs (30 Sep 2026) put check IDs in risk_flags, invented a category and
      // quoted violations under not_observed. State the identifiers and status rules outright.
      allowed_evidence_categories: [...bundle.rubric.evidence_categories, 'compliance'],
      allowed_risk_rule_ids: bundle.risk_policy.rules.map((r) => r.id),
      status_rules: [
        'observed: the learner did the checked behaviour; cite the learner quote(s).',
        'not_observed: the behaviour did not happen; cite no learner quotes and list every searched learner turn.',
        'contradicted: the learner did the opposite; cite the learner quote(s).',
        `For checks satisfied by absence (${Object.keys(runtimeOf(bundle).absence_checks).join(', ')}), a violation is contradicted with the learner quote, never not_observed with a quote. A question that mentions a topic (e.g. asking about a guarantee) is not a violation.`,
        'risk_flags[].rule_id must be one of allowed_risk_rule_ids (never a check ID).',
        'Risk evidence (for a risk flag) has no check_id: omit the field rather than leaving it empty or putting the risk rule there.',
      ],
      ...(contract === '1.1' ? { coaching_rule: `Every dimension_scores item needs "coaching": ONE specific, actionable suggestion for that skill, tied to a moment in the transcript, at most 300 characters, written in ${englishName(input.language ?? 'en')}. "rationale" is the evidence summary, in English.` } : {}),
      previous_errors: [] as string[],
    },
  };

  let accepted: EvaluationCandidate | null = null;
  for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
    const res = await completeWithRetry({ task: 'evaluate', template: input.template, data, schema: evaluationCandidateSchemaFor(contract), temperature: 0, maxTokens: 12000, correlation: input.correlation });
    const text = ids.answerIn(res.text);
    const v = validateCandidate(text, { bundle, turns: input.turns, session_id: input.session_id, transcript_hash: input.transcript_hash, rubric_version: rubricVersion, assessable_learner_turn_ids: rule.assessable_learner_turn_ids, contract_version: contract });
    outputs.push({ attempt, text, ok: v.ok, errors: v.ok ? [] : v.errors, notes: v.notes, provider: res.provider, model: res.model, request_id: res.request_id, latency_ms: res.latency_ms, usage: res.usage });
    if (v.ok) accepted = v.candidate;
    // One repair request with the same evidence snapshot, told what was wrong.
    else data.contract_json.previous_errors = v.errors.slice(0, 30).map(ids.textOut);
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

/** Short turn aliases for the evaluator (T<sequence>), with the mapping back. */
export function turnAliases(turns: TranscriptTurn[]) {
  const toAlias = new Map(turns.map((t) => [t.id, `T${t.sequence}`]));
  const toReal = new Map([...toAlias].map(([real, alias]) => [alias, real]));
  const out = (id: string) => toAlias.get(id) ?? id;
  const back = (id: unknown) => (typeof id === 'string' ? toReal.get(id) ?? id : id);
  const spans = (xs: Span[] | undefined, f: (id: string) => string) => (xs ?? []).map((sp) => ({ ...sp, turn_id: f(sp.turn_id) }));
  return {
    out,
    evidenceOut: (e: Evidence): Evidence => ({ ...e, learner_spans: spans(e.learner_spans, out), context_spans: spans(e.context_spans, out), searched_turn_ids: (e.searched_turn_ids ?? []).map(out) }),
    /** Map an evaluator answer's aliases back to real IDs; unparseable text is left for validation to reject. */
    answerIn: (raw: string): string => {
      let c: { evidence?: { learner_spans?: Span[]; context_spans?: Span[]; searched_turn_ids?: string[] }[] };
      try { c = JSON.parse(raw); } catch { return raw; }
      // Free text may cite turns by alias ("(T6)"); learners never see those.
      for (const d of Array.isArray((c as any)?.dimension_scores) ? (c as any).dimension_scores : []) {
        if (typeof d?.rationale === 'string') d.rationale = stripTurnAliases(d.rationale);
        if (typeof d?.coaching === 'string') d.coaching = stripTurnAliases(d.coaching);
      }
      for (const e of Array.isArray(c?.evidence) ? c.evidence : []) {
        if (typeof (e as any).explanation === 'string') (e as any).explanation = stripTurnAliases((e as any).explanation);
        if (Array.isArray(e.learner_spans)) e.learner_spans = e.learner_spans.map((sp) => ({ ...sp, turn_id: back(sp?.turn_id) as string }));
        if (Array.isArray(e.context_spans)) e.context_spans = e.context_spans.map((sp) => ({ ...sp, turn_id: back(sp?.turn_id) as string }));
        if (Array.isArray(e.searched_turn_ids)) e.searched_turn_ids = e.searched_turn_ids.map((id) => back(id) as string);
      }
      return JSON.stringify(c);
    },
    /** Validation messages name real IDs; the repair request speaks in aliases. */
    textOut: (msg: string) => msg.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => toAlias.get(m) ?? m),
  };
}

/** evaluator_v1 sessions keep contract 1.0; newer prompts ask for per-skill coaching (1.1). */
export const contractVersionFor = (templateId?: string): '1.0' | '1.1' => (!templateId || templateId === 'evaluator_v1' ? '1.0' : '1.1');

/** The scenario's evaluation guide with each cue's turn marked, or null when the scenario has none. */
function evaluationGuideFor(bundle: ScenarioBundle, rule: RuleEvidence, out: (id: string) => string) {
  const g = runtimeOf(bundle).evaluation_guide;
  if (!g) return null;
  return {
    ...g,
    cues: g.cues.map((c) => {
      const t = rule.cue_turns.find((x) => x.fact_id === c.fact_id);
      return { ...c, raised_in_turn: t ? out(t.turn_id) : null, applicable: !!t };
    }),
    note: 'A cue the customer never raised (applicable: false) is not a missed follow-up.',
  };
}

const ALIAS_LIST = String.raw`T\d+(?:\s*(?:,|and|&|or|-|–|और|आणि|व)\s*T\d+)*`;
const TURN_WORDS = String.raw`(?:(?:the\s+)?turns?\s+(?:like\s+|such\s+as\s+)?)?`;
const capital = (lead: string, next?: string) => lead + (next ? next.toUpperCase() : '');

/**
 * Remove turn-alias citations ("(T6)", "in T3", "In T6, you asked…") from text shown to people.
 * A sentence that opens with the reference loses the whole phrase, not just the label: deleting
 * "T6" alone left "In , you asked…" and "In turns like and, try…" in reports (training agent,
 * 7 Oct 2026). Hindi and Marathi open with "T5 में," / "T5 मध्ये,". Text already broken that way
 * is repaired too, so stored reports read correctly.
 */
export function stripTurnAliases(text: string): string {
  const t = text
    .replace(new RegExp(String.raw`(^|[.!?।]\s+)(?:in|at|during|from)\s+${TURN_WORDS}${ALIAS_LIST}\s*,?\s*([a-z])?`, 'gi'), (_, lead: string, next?: string) => capital(lead, next))
    .replace(new RegExp(String.raw`(^|[.!?।]\s+)(?:टर्न\s*)?${ALIAS_LIST}\s*(?:में|मध्ये|मधे|वर)\s*,?\s*`, 'g'), '$1')
    .replace(/\s*\((?:turns?\s+)?T\d+(?:\s*(?:,|and|&|-|–)\s*T\d+)*\)/gi, '')
    .replace(new RegExp(String.raw`\s+(?:in|at|from|during)\s+${TURN_WORDS}${ALIAS_LIST}\b`, 'gi'), '')
    .replace(/\bT\d+\b/g, '');
  return repairDanglingTurnRefs(t).replace(/\s+([.,;:!?।])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** "In , you asked" / "In turns like and, try" / "में, आपने": what deleting the label alone left behind. */
export function repairDanglingTurnRefs(text: string): string {
  return text
    .replace(/(^|[.!?।]\s+)(?:in|at|during|from)\s*(?:(?:the\s+)?turns?\s*(?:like|such\s+as)?\s*)?(?:(?:and|or|&)\s*)*,\s*([a-z])?/gi, (_, lead: string, next?: string) => capital(lead, next))
    .replace(/(^|[.!?।]\s+)(?:में|मध्ये|मधे)\s*,\s*/g, '$1');
}
