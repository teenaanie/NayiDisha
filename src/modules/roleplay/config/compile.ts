import Ajv, { type ErrorObject } from 'ajv';
import { createHash } from 'node:crypto';
import { bundleSchema } from '../contracts/schemas';
import type { ScenarioBundle, Fact } from '../contracts/types';
import { validateRuntimeExtension } from './runtime-extension';

/**
 * Configuration compiler (spec §8, §21).
 *
 * compile() is the single gate every bundle passes, whether it arrives from the
 * builder, a JSON import or the seed: schema first, then the cross-field rules
 * a schema cannot express. Errors carry JSON-pointer paths so the builder can
 * point at the field. Nothing is ever repaired silently; a bundle either
 * validates as written or is rejected.
 */

export interface Issue { path: string; message: string }
export interface CompileResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  bundle: ScenarioBundle | null;
  digest: string | null;
  bytes: number;
}

export const MAX_BUNDLE_BYTES = 1024 * 1024;

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validateSchema = ajv.compile(bundleSchema);

/** Canonical JSON: sorted keys, no insignificant whitespace. The digest is over this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const o = value as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const digestOf = (value: unknown) => sha256(canonicalJson(value));

function schemaIssues(errors: ErrorObject[] | null | undefined): Issue[] {
  return (errors ?? []).map((e) => {
    const extra = e.keyword === 'additionalProperties' ? ` (unknown field "${(e.params as { additionalProperty: string }).additionalProperty}")` : '';
    return { path: e.instancePath || '/', message: `${e.message ?? 'invalid'}${extra}` };
  });
}

/** JSON-pointer lookup, used to check provenance paths resolve. */
function resolvePointer(root: unknown, pointer: string): boolean {
  if (pointer === '/') return true;
  let cur: unknown = root;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object' || !(key in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[key];
  }
  return true;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>(); const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

function valueMatchesType(f: Fact): boolean {
  if (f.value === null) return true;
  if (f.type === 'money') return typeof f.value === 'object' && 'amount_minor' in f.value;
  if (f.type === 'relative_deadline') return typeof f.value === 'object' && 'unit' in f.value;
  return typeof f.value === 'string';
}

export interface CompileOptions {
  /** Prompt template IDs that exist and are approved. Omit to skip the check (e.g. offline lint). */
  availablePromptIds?: string[];
}

export function compile(input: unknown, options: CompileOptions = {}): CompileResult {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const bytes = Buffer.byteLength(text, 'utf8');
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (bytes > MAX_BUNDLE_BYTES) return { ok: false, errors: [{ path: '/', message: `Bundle is ${bytes} bytes; the limit is ${MAX_BUNDLE_BYTES}.` }], warnings, bundle: null, digest: null, bytes };

  let data: unknown;
  try { data = typeof input === 'string' ? parseStrictJson(input) : input; }
  catch (e) { return { ok: false, errors: [{ path: '/', message: (e as Error).message }], warnings, bundle: null, digest: null, bytes }; }

  if (!validateSchema(data)) return { ok: false, errors: schemaIssues(validateSchema.errors), warnings, bundle: null, digest: null, bytes };
  const b = data as unknown as ScenarioBundle;

  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  // ---- unique identifiers --------------------------------------------------
  const groups: [string, string[]][] = [
    ['/facts', b.facts.map((f) => f.id)],
    ['/conversation/intents', b.conversation.intents.map((i) => i.id)],
    ['/conversation/rules', b.conversation.rules.map((r) => r.id)],
    ['/rubric/dimensions', b.rubric.dimensions.map((d) => d.id)],
    ['/rubric/checks', b.rubric.checks.map((c) => c.id)],
    ['/risk_policy/rules', b.risk_policy.rules.map((r) => r.id)],
    ['/scoring/bands', b.scoring.bands.map((x) => x.id)],
    ['/persona/concerns', b.persona.concerns.map((c) => c.id)],
  ];
  for (const [path, ids] of groups) for (const d of duplicates(ids)) err(path, `Duplicate id "${d}".`);

  const facts = new Map(b.facts.map((f) => [f.id, f]));
  const intents = new Set(b.conversation.intents.map((i) => i.id));
  const checks = new Map(b.rubric.checks.map((c) => [c.id, c]));
  const dims = new Map(b.rubric.dimensions.map((d) => [d.id, d]));
  const concerns = new Set(b.persona.concerns.map((c) => c.id));
  const ref = (path: string, kind: string, id: string, set: { has(id: string): boolean }) => { if (!set.has(id)) err(path, `Unknown ${kind} "${id}".`); };

  // ---- scenario ------------------------------------------------------------
  if (b.scenario.target_minutes.min > b.scenario.target_minutes.max) err('/scenario/target_minutes', 'min is greater than max.');
  b.scenario.objective_ids.forEach((id, i) => { if (!checks.has(id) && !intents.has(id)) err(`/scenario/objective_ids/${i}`, `Objective "${id}" is neither a check nor an intent.`); });

  // ---- facts ---------------------------------------------------------------
  b.facts.forEach((f, i) => {
    const p = `/facts/${i}`;
    if (f.knowledge === 'unknown' && f.value !== null) err(`${p}/value`, 'An unknown fact must have a null value; never populate it from assumptions.');
    if (f.knowledge === 'known' && f.value === null) err(`${p}/value`, 'A known fact needs a value.');
    if (!valueMatchesType(f)) err(`${p}/value`, `Value does not match type "${f.type}".`);
    if (f.visibility === 'derived' && !f.prerequisite_fact_ids.length) err(`${p}/prerequisite_fact_ids`, 'A derived fact must list the facts it is derived from.');
    f.release_intents.forEach((id, j) => ref(`${p}/release_intents/${j}`, 'intent', id, intents));
    f.prerequisite_fact_ids.forEach((id, j) => ref(`${p}/prerequisite_fact_ids/${j}`, 'fact', id, facts));
  });
  // Circular prerequisites make a fact unreachable forever.
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { err('/facts', `Circular prerequisites: ${[...trail, id].join(' → ')}.`); return; }
    state.set(id, 1);
    for (const p of facts.get(id)?.prerequisite_fact_ids ?? []) visit(p, [...trail, id]);
    state.set(id, 2);
  };
  for (const f of b.facts) visit(f.id, []);

  // ---- persona -------------------------------------------------------------
  b.persona.concerns.forEach((c, i) => c.fact_refs.forEach((id, j) => ref(`/persona/concerns/${i}/fact_refs/${j}`, 'fact', id, facts)));

  // ---- conversation --------------------------------------------------------
  b.conversation.intents.forEach((it, i) => { if (!it.positive_examples.length) warn(`/conversation/intents/${i}`, 'No positive examples; deterministic matching will rely on the description alone.'); });
  b.conversation.rules.forEach((r, i) => {
    const p = `/conversation/rules/${i}`;
    r.intent_ids.forEach((id, j) => ref(`${p}/intent_ids/${j}`, 'intent', id, intents));
    r.reveal_fact_ids.forEach((id, j) => {
      ref(`${p}/reveal_fact_ids/${j}`, 'fact', id, facts);
      const f = facts.get(id);
      if (f?.knowledge === 'unknown') err(`${p}/reveal_fact_ids/${j}`, `Fact "${id}" is unknown and cannot be revealed.`);
      if (f && !r.intent_ids.some((it) => f.release_intents.includes(it))) warn(`${p}/reveal_fact_ids/${j}`, `Fact "${id}" does not list any of this rule's intents in release_intents.`);
    });
    if (r.concern_id) ref(`${p}/concern_id`, 'concern', r.concern_id, concerns);
  });
  if (b.conversation.max_new_facts_per_turn < 1) err('/conversation/max_new_facts_per_turn', 'Must be at least 1.');
  // Disclosure reachability: every known on-intent fact must be revealable by some rule.
  b.facts.forEach((f, i) => {
    if (f.knowledge !== 'known' || f.visibility !== 'on_intent') return;
    if (!b.conversation.rules.some((r) => r.reveal_fact_ids.includes(f.id))) err(`/facts/${i}`, `Known fact "${f.id}" can never be disclosed: no rule reveals it.`);
  });
  // Every intent a question can hit must lead somewhere: a rule, or an unknown fact that falls back to unknown_response.
  for (const it of b.conversation.intents) {
    const handled = b.conversation.rules.some((r) => r.intent_ids.includes(it.id)) || b.facts.some((f) => f.release_intents.includes(it.id));
    if (!handled) warn('/conversation/intents', `Intent "${it.id}" has no rule and no fact; it will receive the clarification response.`);
  }

  // ---- rubric --------------------------------------------------------------
  b.rubric.dimensions.forEach((d, i) => {
    const p = `/rubric/dimensions/${i}`;
    if (d.min_score > d.max_score) err(p, 'min_score is greater than max_score.');
    if (d.max_score - d.min_score > 20) err(p, 'Score range is implausibly wide (more than 20 steps).');
    const scores = d.anchors.map((a) => a.score);
    for (const s of duplicates(scores.map(String))) err(`${p}/anchors`, `Duplicate anchor for score ${s}.`);
    for (let s = d.min_score; s <= d.max_score; s++) if (!scores.includes(s)) err(`${p}/anchors`, `Missing anchor for score ${s}.`);
    d.anchors.forEach((a, j) => { if (a.score < d.min_score || a.score > d.max_score) err(`${p}/anchors/${j}`, `Anchor score ${a.score} is outside ${d.min_score}–${d.max_score}.`); });
    d.check_ids.forEach((id, j) => ref(`${p}/check_ids/${j}`, 'check', id, checks));
    if (d.applicability === 'conditional' && !d.applicability_rule_id) err(p, 'A conditional dimension needs applicability_rule_id.');
    if (d.applicability === 'required' && d.applicability_rule_id) warn(p, 'applicability_rule_id is ignored on a required dimension.');
  });
  b.rubric.checks.forEach((c, i) => {
    const p = `/rubric/checks/${i}`;
    c.accepted_intents.forEach((id, j) => ref(`${p}/accepted_intents/${j}`, 'intent', id, intents));
    c.expected_fact_ids.forEach((id, j) => ref(`${p}/expected_fact_ids/${j}`, 'fact', id, facts));
    if (!b.rubric.evidence_categories.includes(c.category)) err(`${p}/category`, `Category "${c.category}" is not in evidence_categories.`);
    if (c.credit_requires === 'learner_question' && !c.accepted_intents.length) err(p, 'A learner_question check needs at least one accepted intent.');
    if (!b.rubric.dimensions.some((d) => d.check_ids.includes(c.id))) warn(p, `Check "${c.id}" is not used by any dimension.`);
  });

  // ---- risk policy ---------------------------------------------------------
  b.risk_policy.rules.forEach((r, i) => {
    r.dimension_ids.forEach((id, j) => ref(`/risk_policy/rules/${i}/dimension_ids/${j}`, 'dimension', id, dims));
    if (r.detector !== 'semantic' && !r.examples.length) err(`/risk_policy/rules/${i}`, 'A phrase or hybrid detector needs at least one example.');
  });

  // ---- scoring -------------------------------------------------------------
  scoringChecks(b, err, warn);

  // ---- prompts and retry ---------------------------------------------------
  if (options.availablePromptIds) {
    for (const [k, id] of Object.entries(b.prompts)) if (!options.availablePromptIds.includes(id)) err(`/prompts/${k}`, `Prompt template "${id}" does not exist or is not approved.`);
  }
  b.retry.focused_target_check_ids.forEach((id, j) => ref(`/retry/focused_target_check_ids/${j}`, 'check', id, checks));
  if (b.retry.focused_enabled && !b.retry.focused_target_check_ids.length) err('/retry', 'Focused retry is enabled but has no target checks.');

  validateRuntimeExtension(b, err);

  // ---- provenance ----------------------------------------------------------
  b.provenance.forEach((p, i) => { if (!resolvePointer(b, p.path)) warn(`/provenance/${i}/path`, `Path "${p.path}" does not resolve in this bundle.`); });
  b.facts.forEach((f, i) => {
    if (f.knowledge === 'unknown' && !b.provenance.some((p) => p.path === `/facts/${i}/value` && p.basis === 'unspecified')) {
      warn(`/facts/${i}`, `Unknown fact "${f.id}" has no "unspecified" provenance record.`);
    }
  });

  const ok = errors.length === 0;
  return { ok, errors, warnings, bundle: ok ? b : null, digest: ok ? digestOf(b) : null, bytes };
}

type Report = (path: string, message: string) => void;

function scoringChecks(b: ScenarioBundle, err: Report, warn: Report) {
  const s = b.scoring;
  const dims = b.rubric.dimensions;
  if (s.mode === 'unweighted_sum' && s.band_scale !== 'raw_sum') err('/scoring/band_scale', 'unweighted_sum scoring must use raw_sum bands.');
  if (s.mode === 'weighted_percent' && s.band_scale !== 'percent') err('/scoring/band_scale', 'weighted_percent scoring must define its own percent bands; raw cutoffs cannot be inherited.');
  if (s.mode === 'unweighted_sum' && Object.keys(s.weights).length) warn('/scoring/weights', 'Weights are ignored by unweighted_sum scoring.');
  if (s.mode === 'weighted_percent') {
    for (const d of dims) if (!(d.id in s.weights)) err('/scoring/weights', `No weight for dimension "${d.id}".`);
    for (const k of Object.keys(s.weights)) if (!dims.some((d) => d.id === k)) err(`/scoring/weights/${k}`, `Unknown dimension "${k}".`);
    const vals = Object.values(s.weights);
    if (vals.some((w) => !Number.isFinite(w) || w < 0)) err('/scoring/weights', 'Weights must be finite and non-negative.');
    if (!(vals.reduce((a, w) => a + w, 0) > 0)) err('/scoring/weights', 'Weights must have a positive total.');
  }
  s.bands.forEach((x, i) => { if (!(x.lower < x.upper) && !(x.lower === x.upper && x.upper_inclusive)) err(`/scoring/bands/${i}`, 'Band lower must be below upper.'); });

  // Every attainable result must fall in exactly one band.
  const inBand = (v: number) => s.bands.filter((x) => v >= x.lower && (v < x.upper || (x.upper_inclusive && v === x.upper)));
  if (s.band_scale === 'raw_sum') {
    const required = dims.filter((d) => d.applicability === 'required');
    const all = dims;
    const lo = required.reduce((a, d) => a + d.min_score, 0);
    const hi = all.reduce((a, d) => a + d.max_score, 0);
    for (let v = lo; v <= hi; v++) {
      const n = inBand(v).length;
      if (n === 0) err('/scoring/bands', `Attainable total ${v} is not covered by any band.`);
      if (n > 1) err('/scoring/bands', `Total ${v} falls in ${n} bands; bands must not overlap.`);
    }
  } else {
    const sorted = [...s.bands].sort((a, c) => a.lower - c.lower);
    if (sorted[0].lower > 0) err('/scoring/bands', 'Percent bands must start at 0.');
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].lower !== sorted[i - 1].upper) err('/scoring/bands', `Gap or overlap between "${sorted[i - 1].id}" and "${sorted[i].id}".`);
      if (sorted[i - 1].upper_inclusive) err('/scoring/bands', `Only the highest percent band may include its upper bound ("${sorted[i - 1].id}").`);
    }
    const top = sorted[sorted.length - 1];
    if (!(top.upper > 100 || (top.upper === 100 && top.upper_inclusive))) err('/scoring/bands', 'The highest percent band must include 100.');
  }

  const p = s.risk_effect_parameters as Record<string, unknown>;
  const riskIds = new Set(b.risk_policy.rules.map((r) => r.id));
  const ruleList = (key: string) => {
    const v = p[key];
    if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || !riskIds.has(x))) err(`/scoring/risk_effect_parameters/${key}`, 'Must list existing risk rule IDs.');
  };
  if (s.risk_effect === 'rubric_only' && Object.keys(p).length) warn('/scoring/risk_effect_parameters', 'Ignored when risk_effect is rubric_only.');
  if (s.risk_effect === 'cap') { ruleList('rule_ids'); if (typeof p.max_percent !== 'number' || p.max_percent < 0 || p.max_percent > 100) err('/scoring/risk_effect_parameters/max_percent', 'A cap needs max_percent between 0 and 100.'); }
  if (s.risk_effect === 'deduction') { ruleList('rule_ids'); if (typeof p.percent_points !== 'number' || p.percent_points <= 0 || p.percent_points > 100) err('/scoring/risk_effect_parameters/percent_points', 'A deduction needs percent_points between 0 and 100.'); }
  if (s.risk_effect === 'gate') { ruleList('rule_ids'); if (typeof p.outcome_label !== 'string' || !p.outcome_label) err('/scoring/risk_effect_parameters/outcome_label', 'A gate needs an outcome_label.'); }
}

/** JSON.parse, but duplicate keys are an error rather than last-one-wins (spec §8). */
export function parseStrictJson(text: string): unknown {
  // JSON.parse validates syntax first; the scan below only needs to find keys.
  const value = JSON.parse(text);
  const frames: { kind: 'object' | 'array'; keys: Set<string>; awaitingKey: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const top = frames[frames.length - 1];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (top?.kind === 'object' && top.awaitingKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) throw new Error(`Duplicate key "${key}" in JSON.`);
        top.keys.add(key);
        top.awaitingKey = false;
      }
      i = j;
    } else if (ch === '{') frames.push({ kind: 'object', keys: new Set(), awaitingKey: true });
    else if (ch === '[') frames.push({ kind: 'array', keys: new Set(), awaitingKey: false });
    else if (ch === '}' || ch === ']') frames.pop();
    else if (ch === ',' && top?.kind === 'object') top.awaitingKey = true;
  }
  return value;
}
