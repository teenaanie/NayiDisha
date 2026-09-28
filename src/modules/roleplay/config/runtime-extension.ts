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
  /** Discovery counts as complete once each listed dimension has at least one observed coverage check. */
  discovery_gate: { dimension_ids: string[] } | null;
  /** Intents and risk rules that only fire while discovery is incomplete. */
  discovery_conditioned: string[];
  /** Checks satisfied by the absence of a behaviour rather than an action. */
  absence_checks: Record<string, { risk_rule_ids?: string[]; unexplained_jargon?: boolean; requires_discovery?: boolean }>;
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
}

export const EMPTY_RUNTIME: RuntimeExtension = {
  question_free_intents: [], discovery_gate: null, discovery_conditioned: [], absence_checks: {},
  check_cues: {}, jargon_terms: [], acknowledgement_text: null, derivations: [],
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
}

export type { Issue };
