import type { ScenarioBundle, Fact, Money, Deadline, DisclosureRule } from '../contracts/types';
import { runtimeOf } from '../config/runtime-extension';
import type { Classification } from './intents';

/**
 * Disclosure resolver (spec §9, §10).
 *
 * Truth lives in the bundle; what the learner has earned lives in the ledger.
 * Given one classified learner turn and the facts already disclosed, this
 * decides which facts may be released now and which parts of the reply are
 * exact source fixtures. The roleplay model only ever sees the result.
 */

export interface DisclosurePlan {
  kind: 'answer' | 'clarify' | 'acknowledge';
  matched_rule_ids: string[];
  /** Facts newly released this turn, in rule order, capped by max_new_facts_per_turn. */
  released_fact_ids: string[];
  /** Released + previously disclosed facts: the only facts generation may use. */
  allowed_fact_ids: string[];
  /** Ordered reply parts. Fixture parts are used verbatim; fact parts are generated. */
  parts: ({ kind: 'fixture'; rule_id: string; text: string } | { kind: 'facts'; rule_id: string; fact_ids: string[] } | { kind: 'unknown'; intent_id: string }
    | { kind: 'volunteer'; cue_id: string; text: string; fact_ids: string[] }
    | { kind: 'respond'; question: string })[];
  /** Intents recognised but not answered this turn (cap reached); they can be asked again. */
  deferred_intent_ids: string[];
}

const byPriority = (a: DisclosureRule, b: DisclosureRule) => b.priority - a.priority || a.id.localeCompare(b.id);

export function resolveDisclosure(bundle: ScenarioBundle, cls: Classification, disclosed: Set<string>, opts: { learnerTurnIndex?: number } = {}): DisclosurePlan {
  const plan = resolveAnswer(bundle, cls, disclosed);
  // "How much is that EMI and which bank gave you the loan?": the fixed answer covers the EMI;
  // the bank still gets a short generated reply (which can release no fact), after the answers.
  if (plan.kind === 'answer' && cls.uncovered_question) plan.parts.push({ kind: 'respond', question: cls.uncovered_question });
  return opts.learnerTurnIndex ? volunteerCue(bundle, plan, disclosed, opts.learnerTurnIndex) : plan;
}

/**
 * A due cue the customer has not yet said is appended to the reply (spec: the customer reveals
 * cues the learner should pick up). One per turn, only when the reply is not a clarification,
 * and only if none of its facts (nor any of its `unless_fact_ids`) is already out or being
 * released this turn. The plan kind is left as it was: an acknowledgement still answers the
 * learner's message before the cue.
 */
function volunteerCue(bundle: ScenarioBundle, plan: DisclosurePlan, disclosed: Set<string>, learnerTurnIndex: number): DisclosurePlan {
  if (plan.kind === 'clarify') return plan;
  const out = new Set([...disclosed, ...plan.released_fact_ids]);
  const answered = new Set(plan.matched_rule_ids.flatMap((id) => bundle.conversation.rules.find((r) => r.id === id)?.intent_ids ?? []));
  const open = runtimeOf(bundle).volunteered_cues.filter((c) => c.reveal_fact_ids.every((f) => !out.has(f)) && !(c.unless_fact_ids ?? []).some((f) => out.has(f)));
  // A cue tied to what was just answered belongs here; otherwise the first one that is due.
  const cue = open.find((c) => (c.with_intents ?? []).some((i) => answered.has(i))) ?? open.find((c) => learnerTurnIndex >= c.after_learner_turns);
  if (!cue) return plan;
  plan.parts.push({ kind: 'volunteer', cue_id: cue.id, text: cue.text, fact_ids: [...cue.reveal_fact_ids] });
  plan.released_fact_ids = [...plan.released_fact_ids, ...cue.reveal_fact_ids];
  plan.allowed_fact_ids = Array.from(new Set([...plan.allowed_fact_ids, ...cue.reveal_fact_ids]));
  return plan;
}

function resolveAnswer(bundle: ScenarioBundle, cls: Classification, disclosed: Set<string>): DisclosurePlan {
  const intentIds = new Set(cls.hits.map((h) => h.intent_id));
  const facts = new Map(bundle.facts.map((f) => [f.id, f]));
  const plan: DisclosurePlan = { kind: 'answer', matched_rule_ids: [], released_fact_ids: [], allowed_fact_ids: [], parts: [], deferred_intent_ids: [] };

  if (!intentIds.size) {
    plan.kind = cls.low_confidence ? 'clarify' : 'acknowledge';
    plan.allowed_fact_ids = [...disclosed];
    return plan;
  }

  const rules = [...bundle.conversation.rules].sort(byPriority)
    .filter((r) => (r.match === 'any' ? r.intent_ids.some((i) => intentIds.has(i)) : r.intent_ids.every((i) => intentIds.has(i))));

  // One rule answers an intent: the highest-priority one. Lower-priority rules for
  // the same intent would only repeat it (e.g. an exact fixture and a generic disclose).
  const answered = new Set<string>();
  const cap = bundle.conversation.max_new_facts_per_turn;
  const released: string[] = [];
  for (const r of rules) {
    const fresh = r.intent_ids.filter((i) => intentIds.has(i) && !answered.has(i));
    if (!fresh.length) continue;
    const eligible = r.reveal_fact_ids.filter((id) => {
      const f = facts.get(id);
      return f && f.knowledge === 'known' && f.prerequisite_fact_ids.every((p) => disclosed.has(p) || released.includes(p));
    });
    const newOnes = eligible.filter((id) => !disclosed.has(id) && !released.includes(id));
    if (released.length + newOnes.length > cap) { plan.deferred_intent_ids.push(...fresh); continue; }
    fresh.forEach((i) => answered.add(i));
    plan.matched_rule_ids.push(r.id);
    released.push(...newOnes);
    // An exact source fixture is the first telling of its facts. Asked again ("can you
    // pay up to 3.5 lakh?"), replaying the same sentence ignores the question, so the
    // already-disclosed facts go to generation, which answers what was actually asked.
    // The fixture states the rule's primary facts (those with no prerequisite inside the
    // rule); a follow-up fact gated on them (e.g. the comfortable share of the savings)
    // can only come out on a later ask, through generation.
    const primary = r.reveal_fact_ids.filter((id) => !(facts.get(id)?.prerequisite_fact_ids ?? []).some((p) => r.reveal_fact_ids.includes(p)));
    const retelling = !!r.response_text && eligible.length > 0 && primary.length > 0 && primary.every((id) => disclosed.has(id));
    if (r.response_text && !retelling) plan.parts.push({ kind: 'fixture', rule_id: r.id, text: r.response_text });
    else if (eligible.length) {
      // Facts an earlier part of this reply already states are not repeated.
      const said = new Set(plan.parts.flatMap((p) => (p.kind === 'fixture' ? factsOfRule(bundle, p.rule_id) : p.kind === 'facts' ? p.fact_ids : [])));
      const fresh2 = eligible.filter((id) => !said.has(id));
      if (fresh2.length) plan.parts.push({ kind: 'facts', rule_id: r.id, fact_ids: fresh2 });
      else plan.parts.push({ kind: 'facts', rule_id: r.id, fact_ids: [] });
    }
  }

  // Recognised intents no rule could answer with a known fact get the neutral unknown reply,
  // never an invented value (spec §5 step 5, AT04).
  for (const id of intentIds) {
    if (answered.has(id) || plan.deferred_intent_ids.includes(id)) continue;
    answered.add(id);
    plan.parts.push({ kind: 'unknown', intent_id: id });
  }
  // A rule that matched but had nothing known to say also falls back to unknown.
  for (const r of rules) {
    if (!plan.matched_rule_ids.includes(r.id)) continue;
    const hasPart = plan.parts.some((p) => 'rule_id' in p && p.rule_id === r.id);
    if (!hasPart) plan.parts.push({ kind: 'unknown', intent_id: r.intent_ids.find((i) => intentIds.has(i))! });
  }
  // Parts emptied by de-duplication say nothing.
  plan.parts = plan.parts.filter((p) => p.kind !== 'facts' || p.fact_ids.length);
  // Collapse repeated unknown parts into one reply.
  const firstUnknown = plan.parts.findIndex((p) => p.kind === 'unknown');
  plan.parts = plan.parts.filter((p, i) => p.kind !== 'unknown' || i === firstUnknown);

  plan.released_fact_ids = released;
  plan.allowed_fact_ids = Array.from(new Set([...disclosed, ...released]));
  if (!plan.parts.length) plan.kind = cls.low_confidence ? 'clarify' : 'acknowledge';
  return plan;
}

const factsOfRule = (b: ScenarioBundle, ruleId: string) => b.conversation.rules.find((r) => r.id === ruleId)?.reveal_fact_ids ?? [];

/** Facts public from the opening line, recorded in the ledger at turn 0. */
export const openingFactIds = (b: ScenarioBundle) => b.facts.filter((f) => f.visibility === 'opening' && f.knowledge === 'known').map((f) => f.id);

/**
 * Has the learner explored enough for a pitch to be in order? Each gate
 * dimension needs at least one coverage check its learner has asked about.
 */
export function discoveryComplete(bundle: ScenarioBundle, askedIntentIds: Set<string>): boolean {
  const gate = runtimeOf(bundle).discovery_gate;
  if (!gate) return true;
  const checks = new Map(bundle.rubric.checks.map((c) => [c.id, c]));
  if ((gate.min_asked_checks ?? 1) > 1) {
    const asked = new Set(gate.dimension_ids.flatMap((dimId) => bundle.rubric.dimensions.find((d) => d.id === dimId)?.check_ids ?? [])
      .filter((cid) => { const c = checks.get(cid); return c?.category === 'coverage' && c.accepted_intents.some((i) => askedIntentIds.has(i)); }));
    if (asked.size < gate.min_asked_checks!) return false;
  }
  return gate.dimension_ids.every((dimId) => {
    const dim = bundle.rubric.dimensions.find((d) => d.id === dimId);
    return !!dim?.check_ids.some((cid) => {
      const c = checks.get(cid);
      return c?.category === 'coverage' && c.accepted_intents.some((i) => askedIntentIds.has(i));
    });
  });
}

// ---- rendering facts for the mock and for validation ------------------------

export function formatMoney(m: Money): string {
  if (m.currency === 'INR') {
    const rupees = m.amount_minor / 100;
    if (rupees >= 100000 && rupees % 100000 === 0) return `₹${rupees / 100000} lakh`;
    if (rupees >= 10000000 && rupees % 10000000 === 0) return `₹${rupees / 10000000} crore`;
    return '₹' + rupees.toLocaleString('en-IN');
  }
  return `${(m.amount_minor / 100).toLocaleString('en')} ${m.currency}`;
}
export function formatDeadline(d: Deadline): string { return `${d.amount} ${d.amount === 1 ? d.unit.replace(/s$/, '') : d.unit}`; }

export function renderFact(f: Fact): string | null {
  if (f.value === null) return null;
  if (f.type === 'money') return formatMoney(f.value as Money);
  if (f.type === 'relative_deadline') return formatDeadline(f.value as Deadline);
  return String(f.value);
}

/** Every number a fact can legitimately put in the customer's mouth. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Figures as numbers, with Indian units read as values: "₹4.5 lakh" is 450000, so it matches
 * "₹4,50,000" (training run 233132ec). The digits as written are kept too.
 */
const UNITS: [RegExp, number][] = [[/^(?:lakhs?|lacs?|लाख)/i, 1e5], [/^(?:crores?|करोड़|कोटी)/i, 1e7], [/^(?:thousand|हज़ार|हजार)/i, 1e3]];
/** Each figure in the text: its digits as written, and its value when a unit follows. */
export function figuresIn(text: string): { raw: string; value: string | null }[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => {
    const raw = m[0].replace(/,/g, '');
    const unit = UNITS.find(([re]) => re.test(text.slice(m.index! + m[0].length).trimStart()));
    return { raw, value: unit ? String(Math.round(Number(raw) * unit[1])) : null };
  });
}

