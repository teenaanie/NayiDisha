import type { ScenarioBundle } from '../contracts/types';
import type { Issue } from './compile';

/**
 * `extensions.nd_runtime`: runtime behaviour the v1.0 bundle schema has no
 * field for.
 *
 * Everything here is configuration the platform reads generically; nothing is
 * scenario code. It lives in the namespaced extensions object (the only place
 * the schema allows additions) so the source contract stays untouched. See
 * docs/roleplay/AUTHORING.md for each key and ADR-003 for why it exists.
 */
export interface RuntimeExtension {
  /** Intents that match statements as well as questions (e.g. a product pitch). */
  question_free_intents: string[];
  /**
   * Discovery counts as complete once each listed dimension has at least one observed coverage
   * check, and at least `min_asked_checks` distinct coverage checks have been asked across them
   * (default 1; a single-dimension gate needs a higher minimum to mean anything).
   */
  discovery_gate: { dimension_ids: string[]; min_asked_checks?: number } | null;
  /** Intents and risk rules that only fire while discovery is incomplete. */
  discovery_conditioned: string[];
  /** Checks satisfied by the absence of a behaviour rather than an action. */
  /**
   * Checks satisfied by absence. `multiple_questions`: a learner message asking two or more real
   * questions is a violation the rules record themselves (with the quote), whatever the model says.
   */
  absence_checks: Record<string, { risk_rule_ids?: string[]; unexplained_jargon?: boolean; requires_discovery?: boolean; multiple_questions?: boolean }>;
  /** Phrase cues for checks judged qualitatively; the mock evaluator uses them, a live evaluator sees them as examples. */
  check_cues: Record<string, string[]>;
  /** Terms that count as jargon unless explained in the same turn. */
  jargon_terms: string[];
  /** Neutral in-character reply to a statement that asks nothing (mock and fallback). */
  acknowledgement_text: string | null;
  /**
   * Server-side arithmetic over money facts, always labelled conditional. Given
   * to the evaluator as context; never spoken by the customer, never a loan offer.
   */
  derivations: { id: string; operation: 'subtract'; input_fact_ids: string[]; assumptions: string[]; excluded_note: string }[];
  /**
   * Extra conversation languages (the source language is always available). Every
   * text the customer says verbatim is given here; generated replies follow
   * `reply_instruction`. Anything missing falls back to the source text.
   */
  translations: Record<string, Translation>;
  /**
   * Lines the customer volunteers unprompted, so a learner has cues to pick up on (spec:
   * "customer cues and expected probing opportunities"). A cue is spoken at the end of the
   * reply once the learner has sent `after_learner_turns` messages, if none of its facts has
   * been disclosed yet; at most one per turn, never in a clarification. With `with_intents`
   * it also comes straight after the answer to one of those intents ("I need about ₹4 lakh.
   * But I don't want a very high EMI."), and `unless_fact_ids` drops it once the learner has
   * already drawn out what the cue points to (no cue to follow up on a topic already covered).
   */
  volunteered_cues: { id: string; text: string; reveal_fact_ids: string[]; after_learner_turns: number; with_intents?: string[]; unless_fact_ids?: string[] }[];
  /**
   * Follow-up checks tied to cues: once a customer turn has stated one of `cue_fact_ids`, a
   * later learner question on one of `follow_up_intents` earns the check. A cue that never
   * surfaced makes the check inapplicable rather than missed.
   */
  cue_follow_ups: { check_id: string; cue_fact_ids: string[]; follow_up_intents: string[] }[];
  /**
   * The evaluator's knowledge base (spec "Knowledge base the evaluator needs"): the discovery
   * framework (not a checklist), cues with the expected follow-up, acceptable question
   * variations, and rules that stop one behaviour being scored under several skills.
   */
  evaluation_guide: EvaluationGuide | null;
  /** Practice reminders, in minutes; default the scenario's target range. */
  reminder_minutes: number[] | null;
  /**
   * Words that would reveal a fact before it is out. A generated reply may not use them while
   * the fact is not authorised, unless the learner said the word first. Exact values are
   * already checked; this catches the topic ("my son's college fees" before anyone asked).
   */
  hidden_fact_terms: Record<string, string[]>;
  /**
   * Per risk rule, harmless sentences that resemble its examples. A sentence closer to one of
   * these than to any example is not a rule candidate: "Please submit your documents" matched
   * "You don't need to submit any documents" and "quick approval process" matched approval
   * promises (training run 233132ec, 8 Oct 2026).
   */
  risk_not_examples: Record<string, string[]>;
  /** Words a generated reply may never use, because they contradict the profile (e.g. "son"). */
  forbidden_terms: string[];
  /**
   * When the learner uses one of `learner_terms` ("your son"), the customer corrects them with a
   * fixed line first ("Actually, it's my daughter, not my son."), by language. Generated replies
   * cannot say the wrong word themselves (forbidden_terms), so without this they could not.
   */
  corrections: { id: string; learner_terms: string[]; text: Record<string, string> }[];
}

export interface EvaluationGuide {
  /**
   * Per skill: what it measures (shown in the report), what the evaluator looks for, and the
   * owner's fuller guidance for every score (the rubric anchors stay the short report wording).
   */
  skills: { dimension_id: string; measures: string; look_for: string[]; score_guidance: { score: number; guidance: string }[] }[];
  /** Names for each score level, e.g. {"1": "Needs Improvement", "3": "Competent"} (report labels). */
  level_labels?: Record<string, string>;
  framework_note: string;
  /** Discovery areas in priority order (also the order of "top missed questions"). */
  /** `phrases`: how an assessor's text names the area, to catch a follow-up calling it missed. */
  framework: { area: string; information: string; check_id: string; phrases?: string[] }[];
  cues: { fact_id: string; customer_line: string; expected_follow_up: string; check_id: string; phrases?: string[] }[];
  variations: { check_id: string; examples: string[] }[];
  exclusions: string[];
  principles: string[];
}

export interface Translation {
  /** Shown in the language picker, in that language. */
  label: string;
  /** 'draft' until a fluent reviewer signs it off; the picker says so. */
  review_status: 'draft' | 'reviewed';
  opening_text: string;
  learner_brief: string;
  unknown_response: string;
  clarification_response: string;
  acknowledgement_text?: string;
  /** Exact translations of rules' response_text, by rule ID. */
  rule_responses: Record<string, string>;
  /** One example learner question per intent, for coaching and retry suggestions. */
  intent_examples: Record<string, string>;
  /** Lead sentence of a personalised retry instruction. */
  retry_lead: string;
  /** Appended to the customer's speaking style for generated replies. */
  reply_instruction: string;
  /** Tells the coach which language to write feedback in. */
  feedback_instruction: string;
  /** Exact translations of volunteered cue lines, by cue ID. */
  cue_responses?: Record<string, string>;
}

export const TRANSLATABLE_LANGUAGES = ['hi', 'mr'] as const;

export const EMPTY_RUNTIME: RuntimeExtension = {
  question_free_intents: [], discovery_gate: null, discovery_conditioned: [], absence_checks: {},
  check_cues: {}, jargon_terms: [], acknowledgement_text: null, derivations: [], translations: {},
  volunteered_cues: [], cue_follow_ups: [], evaluation_guide: null, reminder_minutes: null,
  hidden_fact_terms: {}, risk_not_examples: {}, forbidden_terms: [], corrections: [],
};

export function runtimeOf(b: ScenarioBundle): RuntimeExtension {
  const raw = (b.extensions?.nd_runtime ?? {}) as Partial<RuntimeExtension>;
  return { ...EMPTY_RUNTIME, ...raw };
}

const KNOWN_KEYS = Object.keys(EMPTY_RUNTIME);

/** Cross-reference checks for the extension, called from compile(). */
export function validateRuntimeExtension(b: ScenarioBundle, err: (p: string, m: string) => void) {
  const raw = b.extensions?.nd_runtime;
  if (raw === undefined) return;
  const P = '/extensions/nd_runtime';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { err(P, 'Must be an object.'); return; }
  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.includes(k)) err(`${P}/${k}`, `Unknown runtime key "${k}".`);
  const x = runtimeOf(b);
  const intents = new Set(b.conversation.intents.map((i) => i.id));
  const risks = new Set(b.risk_policy.rules.map((r) => r.id));
  const checks = new Set(b.rubric.checks.map((c) => c.id));
  const dims = new Set(b.rubric.dimensions.map((d) => d.id));
  const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim());
  if (!strings(x.question_free_intents)) err(`${P}/question_free_intents`, 'Must be a list of intent IDs.');
  else x.question_free_intents.forEach((id, i) => { if (!intents.has(id)) err(`${P}/question_free_intents/${i}`, `Unknown intent "${id}".`); });
  if (x.discovery_gate) {
    if (!strings(x.discovery_gate.dimension_ids) || !x.discovery_gate.dimension_ids.length) err(`${P}/discovery_gate`, 'Needs dimension_ids.');
    else x.discovery_gate.dimension_ids.forEach((id, i) => { if (!dims.has(id)) err(`${P}/discovery_gate/dimension_ids/${i}`, `Unknown dimension "${id}".`); });
    const m = x.discovery_gate.min_asked_checks;
    if (m !== undefined && !(Number.isInteger(m) && m >= 1 && m <= 50)) err(`${P}/discovery_gate/min_asked_checks`, 'Must be a whole number from 1 to 50.');
  }
  if (!strings(x.discovery_conditioned)) err(`${P}/discovery_conditioned`, 'Must be a list of IDs.');
  else x.discovery_conditioned.forEach((id, i) => { if (!intents.has(id) && !risks.has(id)) err(`${P}/discovery_conditioned/${i}`, `"${id}" is neither an intent nor a risk rule.`); });
  if (x.discovery_conditioned.length && !x.discovery_gate) err(`${P}/discovery_conditioned`, 'Needs a discovery_gate to condition on.');
  for (const [id, spec] of Object.entries(x.absence_checks)) {
    if (!checks.has(id)) err(`${P}/absence_checks/${id}`, `Unknown check "${id}".`);
    for (const r of spec.risk_rule_ids ?? []) if (!risks.has(r)) err(`${P}/absence_checks/${id}`, `Unknown risk rule "${r}".`);
  }
  for (const [id, cues] of Object.entries(x.check_cues)) {
    if (!checks.has(id)) err(`${P}/check_cues/${id}`, `Unknown check "${id}".`);
    if (!strings(cues)) err(`${P}/check_cues/${id}`, 'Cues must be non-empty strings.');
  }
  if (!strings(x.jargon_terms)) err(`${P}/jargon_terms`, 'Must be a list of strings.');
  const facts = new Map(b.facts.map((f) => [f.id, f]));
  x.derivations.forEach((d, i) => {
    if (d.operation !== 'subtract') err(`${P}/derivations/${i}/operation`, 'Only "subtract" is supported.');
    if (!Array.isArray(d.input_fact_ids) || d.input_fact_ids.length < 2) err(`${P}/derivations/${i}`, 'Needs at least two input facts.');
    for (const id of d.input_fact_ids ?? []) if (facts.get(id)?.type !== 'money') err(`${P}/derivations/${i}`, `Input "${id}" is not a money fact.`);
    if (!strings(d.assumptions) || !d.assumptions.length) err(`${P}/derivations/${i}/assumptions`, 'A derivation must state its assumptions.');
  });
  if (x.acknowledgement_text !== null && (typeof x.acknowledgement_text !== 'string' || !x.acknowledgement_text.trim())) err(`${P}/acknowledgement_text`, 'Must be text or null.');
  const rules = new Map(b.conversation.rules.map((r) => [r.id, r]));
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  for (const [lang, t] of Object.entries(x.translations ?? {})) {
    const T = `${P}/translations/${lang}`;
    if (!(TRANSLATABLE_LANGUAGES as readonly string[]).includes(lang)) { err(T, `Unsupported language "${lang}" (supported: ${TRANSLATABLE_LANGUAGES.join(', ')}).`); continue; }
    for (const k of ['label', 'opening_text', 'learner_brief', 'unknown_response', 'clarification_response', 'retry_lead', 'reply_instruction', 'feedback_instruction'] as const) if (!text(t[k])) err(`${T}/${k}`, 'Required text.');
    if (!['draft', 'reviewed'].includes(t.review_status)) err(`${T}/review_status`, 'Must be "draft" or "reviewed".');
    if (t.acknowledgement_text !== undefined && !text(t.acknowledgement_text)) err(`${T}/acknowledgement_text`, 'Must be text when given.');
    for (const [rid, v] of Object.entries(t.rule_responses ?? {})) {
      if (!rules.has(rid)) err(`${T}/rule_responses/${rid}`, `Unknown rule "${rid}".`);
      else if (!rules.get(rid)!.response_text) err(`${T}/rule_responses/${rid}`, `Rule "${rid}" has no response_text to translate.`);
      if (!text(v)) err(`${T}/rule_responses/${rid}`, 'Required text.');
    }
    // Every verbatim line must be translated, or a session would switch language mid-conversation.
    for (const r of b.conversation.rules) if (r.response_text && !t.rule_responses?.[r.id]) err(`${T}/rule_responses`, `Missing translation for rule "${r.id}".`);
    for (const [iid, v] of Object.entries(t.intent_examples ?? {})) {
      if (!intents.has(iid)) err(`${T}/intent_examples/${iid}`, `Unknown intent "${iid}".`);
      if (!text(v)) err(`${T}/intent_examples/${iid}`, 'Required text.');
    }
    for (const c of x.volunteered_cues ?? []) if (!text(t.cue_responses?.[c.id])) err(`${T}/cue_responses`, `Missing translation for cue "${c.id}".`);
    for (const id of Object.keys(t.cue_responses ?? {})) if (!(x.volunteered_cues ?? []).some((c) => c.id === id)) err(`${T}/cue_responses/${id}`, `Unknown cue "${id}".`);
  }

  // ---- volunteered cues, cue follow-ups, evaluation guide, reminders --------------
  const cueIds = new Set<string>();
  let lastTurn = 0;
  (x.volunteered_cues ?? []).forEach((c, i) => {
    const C = `${P}/volunteered_cues/${i}`;
    if (!text(c.id) || cueIds.has(c.id)) err(`${C}/id`, 'Needs a unique id.');
    cueIds.add(c.id);
    if (!text(c.text)) err(`${C}/text`, 'Required text.');
    if (!strings(c.reveal_fact_ids) || !c.reveal_fact_ids.length) err(`${C}/reveal_fact_ids`, 'Needs at least one fact.');
    else c.reveal_fact_ids.forEach((f) => { if (facts.get(f)?.knowledge !== 'known') err(`${C}/reveal_fact_ids`, `"${f}" is not a known fact.`); });
    if (!(Number.isInteger(c.after_learner_turns) && c.after_learner_turns >= 1)) err(`${C}/after_learner_turns`, 'Must be a whole number of at least 1.');
    else { if (c.after_learner_turns < lastTurn) err(`${C}/after_learner_turns`, 'Cues must be listed in the order they become due.'); lastTurn = c.after_learner_turns; }
     if (c.with_intents !== undefined) { if (!strings(c.with_intents)) err(`${C}/with_intents`, 'Must be a list of intent IDs.'); else c.with_intents.forEach((id) => { if (!intents.has(id)) err(`${C}/with_intents`, `Unknown intent "${id}".`); }); }
    if (c.unless_fact_ids !== undefined) { if (!strings(c.unless_fact_ids)) err(`${C}/unless_fact_ids`, 'Must be a list of fact IDs.'); else c.unless_fact_ids.forEach((f) => { if (!facts.has(f)) err(`${C}/unless_fact_ids`, `Unknown fact "${f}".`); }); }
  });
  (x.cue_follow_ups ?? []).forEach((c, i) => {
    const C = `${P}/cue_follow_ups/${i}`;
    if (!checks.has(c.check_id)) err(`${C}/check_id`, `Unknown check "${c.check_id}".`);
    if (!strings(c.cue_fact_ids) || !c.cue_fact_ids.length) err(`${C}/cue_fact_ids`, 'Needs at least one fact.');
    else c.cue_fact_ids.forEach((f) => { if (!facts.has(f)) err(`${C}/cue_fact_ids`, `Unknown fact "${f}".`); });
    if (!strings(c.follow_up_intents) || !c.follow_up_intents.length) err(`${C}/follow_up_intents`, 'Needs at least one intent.');
    else c.follow_up_intents.forEach((id) => { if (!intents.has(id)) err(`${C}/follow_up_intents`, `Unknown intent "${id}".`); });
  });
  const g = x.evaluation_guide;
  if (g) {
    const G = `${P}/evaluation_guide`;
    (g.skills ?? []).forEach((k, i) => {
      const dim = b.rubric.dimensions.find((d) => d.id === k.dimension_id);
      if (!dim) err(`${G}/skills/${i}/dimension_id`, `Unknown dimension "${k.dimension_id}".`);
      if (!text(k.measures)) err(`${G}/skills/${i}/measures`, 'Required text.');
      if (!strings(k.look_for)) err(`${G}/skills/${i}/look_for`, 'Must be a list of behaviours.');
      (k.score_guidance ?? []).forEach((sg, j) => { if (dim && !dim.anchors.some((a) => a.score === sg.score)) err(`${G}/skills/${i}/score_guidance/${j}`, `Score ${sg.score} is not an anchor of "${dim.id}".`); if (!text(sg.guidance)) err(`${G}/skills/${i}/score_guidance/${j}`, 'Required text.'); });
    });
    if (!text(g.framework_note)) err(`${G}/framework_note`, 'Required text.');
    if (!Array.isArray(g.framework) || !g.framework.length) err(`${G}/framework`, 'Needs at least one discovery area.');
    else g.framework.forEach((a, i) => { if (!text(a.area) || !text(a.information)) err(`${G}/framework/${i}`, 'Needs area and information.'); if (!checks.has(a.check_id)) err(`${G}/framework/${i}/check_id`, `Unknown check "${a.check_id}".`); });
    (g.cues ?? []).forEach((c, i) => { if (!facts.has(c.fact_id)) err(`${G}/cues/${i}/fact_id`, `Unknown fact "${c.fact_id}".`); if (!checks.has(c.check_id)) err(`${G}/cues/${i}/check_id`, `Unknown check "${c.check_id}".`); if (!text(c.customer_line) || !text(c.expected_follow_up)) err(`${G}/cues/${i}`, 'Needs customer_line and expected_follow_up.'); });
    (g.variations ?? []).forEach((v, i) => { if (!checks.has(v.check_id)) err(`${G}/variations/${i}/check_id`, `Unknown check "${v.check_id}".`); if (!strings(v.examples) || v.examples.length < 2) err(`${G}/variations/${i}/examples`, 'Give at least two equivalent wordings.'); });
    if (!strings(g.exclusions)) err(`${G}/exclusions`, 'Must be a list of rules.');
    if (!strings(g.principles)) err(`${G}/principles`, 'Must be a list of rules.');
  }
  const factIds = new Set(b.facts.map((f) => f.id));
  for (const [r, ex] of Object.entries(x.risk_not_examples ?? {})) {
    if (!risks.has(r)) err(`${P}/risk_not_examples/${r}`, `Unknown risk rule "${r}".`);
    if (!strings(ex) || !(ex as string[]).length) err(`${P}/risk_not_examples/${r}`, 'Must be a non-empty list of sentences.');
  }
  if (typeof x.hidden_fact_terms !== 'object' || x.hidden_fact_terms === null || Array.isArray(x.hidden_fact_terms)) err(`${P}/hidden_fact_terms`, 'Must be an object of fact ID → words.');
  else for (const [f, terms] of Object.entries(x.hidden_fact_terms)) {
    if (!factIds.has(f)) err(`${P}/hidden_fact_terms/${f}`, `Unknown fact "${f}".`);
    if (!strings(terms)) err(`${P}/hidden_fact_terms/${f}`, 'Must be a list of words.');
  }
  if (!strings(x.forbidden_terms) && !(Array.isArray(x.forbidden_terms) && !x.forbidden_terms.length)) err(`${P}/forbidden_terms`, 'Must be a list of words.');
  if (!Array.isArray(x.corrections)) err(`${P}/corrections`, 'Must be a list.');
  else {
    const seen = new Set<string>();
    x.corrections.forEach((c, i) => {
      const C = `${P}/corrections/${i}`;
      if (!text(c?.id) || seen.has(c.id)) err(`${C}/id`, 'Needs a unique id.');
      seen.add(c?.id);
      if (!strings(c?.learner_terms) || !c.learner_terms.length) err(`${C}/learner_terms`, 'Needs at least one word.');
      if (!c?.text || typeof c.text !== 'object' || !text(c.text.en)) err(`${C}/text`, 'Needs at least the English line (text.en).');
    });
  }
  if (x.reminder_minutes !== null && x.reminder_minutes !== undefined) {
    const r = x.reminder_minutes;
    if (!Array.isArray(r) || !r.length || r.some((m, i) => !(Number.isInteger(m) && m > 0 && m <= 120) || (i > 0 && m <= r[i - 1]))) err(`${P}/reminder_minutes`, 'Must be ascending whole minutes between 1 and 120.');
  }
}

export type { Issue };
