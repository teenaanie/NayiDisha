import type { ScenarioBundle, TranscriptTurn, Evidence, Span, RiskRule } from '../contracts/types';
import { runtimeOf } from '../config/runtime-extension';
import { classify, CLASSIFIER_VERSION } from '../runtime/intents';
import { discoveryComplete } from '../runtime/disclosure';
import { localized, type Language } from '../runtime/language';
import { sentences, isQuestion, isNegatedBefore, isAttributedOrQuoted, isHypothetical, coverage, cpSlice, cpIndexOf, cpLength, type Sentence } from '../runtime/text';

/**
 * Rule evidence (spec §13 step 1–3).
 *
 * High-precision evidence producers. They never award a score; they hand the
 * evaluator exact learner spans for what clearly happened and a complete
 * search record for what did not. A keyword alone is never enough: coverage
 * needs a question, and a risk phrase is discarded when negated, asked about,
 * attributed to someone else, or hypothetical.
 */

export const RULE_VERSION = 'rules-1.3.0';

export interface RiskCandidate { rule_id: string; evidence_id: string; turn_id: string; sentence: string; similarity: number }
export interface RuleEvidence {
  evidence: Evidence[];
  risk_candidates: RiskCandidate[];
  /** Learner turns the evaluator may credit (focused retries exclude the cloned prefix). */
  assessable_learner_turn_ids: string[];
  /** Intents asked per learner turn, in order; drives the discovery gate. */
  asked_by_turn: { turn_id: string; intents: string[] }[];
  unexplained_jargon: { term: string; turn_id: string }[];
  /** Cue follow-up checks whose cue never came up: not applicable, so neither met nor missed. */
  inapplicable_check_ids: string[];
  /** Where each configured cue first came up (customer turn), for the evaluator's guide. */
  cue_turns: { fact_id: string; turn_id: string }[];
}

const spanOf = (turn: TranscriptTurn, s: Sentence): Span => ({ turn_id: turn.id, start: s.start, end: s.end, quote: s.text });
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);

/** Best-matching risk example for a sentence, with the same two-word floor as intents. */
function riskSimilarity(rule: RiskRule, sentence: string): { score: number; example: string } {
  let best = { score: 0, example: '' };
  for (const ex of rule.examples) {
    const c = coverage(ex, sentence);
    if (c.matched >= Math.min(2, c.total) && c.score > best.score) best = { score: c.score, example: ex };
  }
  return best;
}

/**
 * Negation that governs the matched phrase: same clause, shortly before it.
 * A negation that is part of the risk phrase itself ("Don't worry about
 * documents") is the risk, not a denial of it.
 */
function negatesMatch(sentence: string, matchAt: number, example: string): boolean {
  if (/\b(not|no|never|don['’]?t|won['’]?t|can['’]?t|cannot)\b/i.test(example)) return false;
  const clause = cpSlice(sentence, 0, matchAt).split(/[,;:–—]|\s-\s/).pop() ?? '';
  return isNegatedBefore(clause, cpLength(clause));
}

export interface RecordedIntent { intent_id: string; question: boolean; start?: number; end?: number }

/**
 * `recordedIntents` are the intents the runtime acted on when the turn was live
 * (from turn_analysis). Using them keeps scoring consistent with what the
 * customer understood; turns without a record fall back to the phrase matcher.
 */
export function extractRuleEvidence(bundle: ScenarioBundle, turns: TranscriptTurn[], opts: { excludeOrigins?: TranscriptTurn['origin'][]; recordedIntents?: Map<string, RecordedIntent[]>; language?: Language } = {}): RuleEvidence {
  const rt = runtimeOf(bundle);
  const excluded = new Set(opts.excludeOrigins ?? []);
  const learner = turns.filter((t) => t.speaker === 'learner');
  const assessable = learner.filter((t) => !excluded.has(t.origin));
  const assessableIds = assessable.map((t) => t.id);
  const evidence: Evidence[] = [];
  const risk: RiskCandidate[] = [];
  const asked = new Set<string>();
  const askedByTurn: RuleEvidence['asked_by_turn'] = [];
  const askedInPrefix = new Set<string>();   // intents asked in turns copied from the first attempt
  const observed = new Map<string, Span[]>();   // check_id -> spans
  const questionHits = new Map<string, { intent_id: string; span: Span }[]>();   // learner turn -> asked intents

  // ---- coverage: which checks did the learner actually ask about? ----------
  const checksByIntent = new Map<string, string[]>();
  for (const c of bundle.rubric.checks) {
    if (c.credit_requires !== 'learner_question') continue;
    for (const i of c.accepted_intents) checksByIntent.set(i, [...(checksByIntent.get(i) ?? []), c.id]);
  }
  for (const t of learner) {
    const recorded = opts.recordedIntents?.get(t.id);
    const cls = recorded ? { hits: recorded.map((r) => ({ intent_id: r.intent_id, question: r.question, sentence: recordedSentence(t.text, r) })) } : classify(bundle, t.text, { discoveryComplete: discoveryComplete(bundle, asked) });
    const intents: string[] = [];
    for (const h of cls.hits) {
      if (!h.question) continue;
      intents.push(h.intent_id);
      if (excluded.has(t.origin)) continue;   // prefix turns set context, never earn credit
      questionHits.set(t.id, [...(questionHits.get(t.id) ?? []), { intent_id: h.intent_id, span: spanOf(t, h.sentence) }]);
      for (const cid of checksByIntent.get(h.intent_id) ?? []) {
        const spans = observed.get(cid) ?? [];
        if (!spans.some((s) => s.turn_id === t.id && s.start === h.sentence.start)) spans.push(spanOf(t, h.sentence));
        observed.set(cid, spans);
      }
    }
    intents.forEach((i) => asked.add(i));
    if (excluded.has(t.origin)) intents.forEach((i) => askedInPrefix.add(i));
    askedByTurn.push({ turn_id: t.id, intents });

    // ---- risk candidates ---------------------------------------------------
    if (excluded.has(t.origin)) continue;
    const gateOpen = !discoveryComplete(bundle, new Set(askedByTurn.slice(0, -1).flatMap((x) => x.intents)));
    // A message that asks a discovery question is discovery, not a pitch: "Now let us go to the
    // rest of your loans. What is your monthly income?" matched "You should take this loan now."
    // on "loan" + "now" and was confirmed as a premature pitch (live run, 6 Oct 2026).
    const asksDiscovery = intents.some((i) => !rt.question_free_intents.includes(i));
    for (const s of sentences(t.text)) {
      for (const rule of bundle.risk_policy.rules) {
        if (rule.detector === 'semantic') continue;          // needs the model; no rule candidate
        if (rt.discovery_conditioned.includes(rule.id) && (!gateOpen || asksDiscovery)) continue;
        const { score: sim, example } = riskSimilarity(rule, s.text);
        if (sim < 0.6) continue;
        // Guards: "I cannot guarantee approval", "Did someone promise you approval?",
        // "He said it would be approved", "If I said it was guaranteed..." are not promises.
        const firstMatch = firstMatchedWord(rule, s.text, example);
        if (isQuestion(s.text) || isAttributedOrQuoted(s.text) || isHypothetical(s.text) || negatesMatch(s.text, firstMatch, example)) continue;
        const id = safeId(`risk_${rule.id}_${risk.length + 1}`);
        risk.push({ rule_id: rule.id, evidence_id: id, turn_id: t.id, sentence: s.text, similarity: Math.round(sim * 100) / 100 });
        evidence.push({
          id, category: 'compliance', status: 'observed', learner_spans: [spanOf(t, s)], context_spans: [], searched_turn_ids: [],
          explanation: `Affirmative statement matching risk rule "${rule.id}" (${rule.description}).`, method: 'rule', confidence: Math.min(0.95, 0.6 + sim / 3), rule_version: RULE_VERSION,
        });
      }
    }
  }

  // ---- cue checks (qualitative behaviour with configured cue phrases) -------
  for (const [checkId, cues] of Object.entries(rt.check_cues)) {
    for (const t of assessable) {
      const lower = t.text.toLowerCase().replace(/’/g, "'");
      for (const cue of cues) {
        const at = lower.indexOf(cue.toLowerCase());
        if (at < 0) continue;
        const cpAt = cpLength(t.text.slice(0, at));
        const s = sentences(t.text).find((x) => cpAt >= x.start && cpAt < x.end);
        if (!s) continue;
        const spans = observed.get(checkId) ?? [];
        if (!spans.some((x) => x.turn_id === t.id && x.start === s.start)) spans.push(spanOf(t, s));
        observed.set(checkId, spans);
        break;
      }
    }
  }

  // ---- jargon ---------------------------------------------------------------
  const jargon: RuleEvidence['unexplained_jargon'] = [];
  const explainCues = rt.check_cues['explains_jargon'] ?? [];
  for (const t of assessable) {
    const lower = t.text.toLowerCase();
    for (const term of rt.jargon_terms) {
      if (!new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) continue;
      if (explainCues.some((c) => lower.includes(c.toLowerCase()))) continue;
      jargon.push({ term, turn_id: t.id });
    }
  }

  // ---- cue follow-ups: did the learner pick up what the customer volunteered? --
  // A cue "comes up" in the customer turn that says its line: the opening, the verbatim
  // rule answer that releases it, or the volunteered cue line (in the session language).
  const L = localized(bundle, opts.language ?? 'en');
  const facts = new Map(bundle.facts.map((f) => [f.id, f]));
  const linesFor = (factId: string) => [
    ...bundle.conversation.rules.filter((r) => r.response_text && r.reveal_fact_ids.includes(factId)).map((r) => L.ruleResponse(r.id, r.response_text!)),
    ...rt.volunteered_cues.filter((c) => c.reveal_fact_ids.includes(factId)).map((c) => L.cueResponse(c.id, c.text)),
  ].map((x) => x.trim()).filter(Boolean);
  const customer = turns.filter((t) => t.speaker === 'customer');
  const cueTurn = (factId: string) => {
    if (facts.get(factId)?.visibility === 'opening') return customer.find((t) => t.origin === 'opening' || t.sequence === 0);
    const lines = linesFor(factId);
    return customer.find((t) => lines.some((line) => t.text.includes(line)));
  };
  const inapplicable: string[] = [];
  const cueTurns: RuleEvidence['cue_turns'] = [];
  for (const f of new Set(rt.cue_follow_ups.flatMap((c) => c.cue_fact_ids))) { const ct = cueTurn(f); if (ct) cueTurns.push({ fact_id: f, turn_id: ct.id }); }
  for (const cf of rt.cue_follow_ups) {
    const surfaced = cf.cue_fact_ids.map((f) => cueTurns.find((x) => x.fact_id === f)).filter(Boolean).map((x) => turns.find((t) => t.id === x!.turn_id)!).sort((a, b) => a.sequence - b.sequence)[0];
    if (!surfaced) { inapplicable.push(cf.check_id); continue; }
    const after = assessable.filter((t) => t.sequence > surfaced.sequence);
    const hit = after.flatMap((t) => (questionHits.get(t.id) ?? []).filter((h) => cf.follow_up_intents.includes(h.intent_id)))[0];
    if (hit) observed.set(cf.check_id, [...(observed.get(cf.check_id) ?? []), hit.span]);
    else if (!observed.has(cf.check_id)) {
      evidence.push({
        id: safeId(`ev_${cf.check_id}`), category: bundle.rubric.checks.find((c) => c.id === cf.check_id)?.category ?? 'conversation', check_id: cf.check_id, status: 'not_observed',
        learner_spans: [], context_spans: [{ turn_id: surfaced.id, start: 0, end: cpLength(surfaced.text), quote: surfaced.text }], searched_turn_ids: after.map((t) => t.id),
        explanation: `The customer raised this cue but no later learner question followed it up.`, method: 'rule', confidence: 0.8, rule_version: RULE_VERSION,
      });
    }
  }

  // ---- one evidence record per check: observed spans, or a complete search --
  for (const c of bundle.rubric.checks) {
    const spans = observed.get(c.id);
    if (spans?.length) {
      evidence.push({
        id: safeId(`ev_${c.id}`), category: c.category, check_id: c.id, status: 'observed',
        learner_spans: spans.slice(0, 3), context_spans: [], searched_turn_ids: [],
        explanation: c.credit_requires === 'learner_question' ? `Learner asked: ${c.description.toLowerCase()}.` : `Learner showed: ${c.description.toLowerCase()}.`,
        method: c.credit_requires === 'learner_question' ? 'semantic' : 'rule', confidence: 0.9, rule_version: RULE_VERSION,
      });
    } else if (c.credit_requires === 'learner_question') {
      // Cue phrases ("you mentioned", "I understand") can show a skill, but their absence
      // proves nothing: learners follow up without them. A confident rule-made
      // not_observed here anchored the evaluator, which then never credited a clear
      // follow-up (live runs, 29 Sep 2026). Unmatched cue checks are left to judgement.
      evidence.push({
        id: safeId(`ev_${c.id}`), category: c.category, check_id: c.id, status: 'not_observed',
        learner_spans: [], context_spans: [], searched_turn_ids: assessableIds,
        // In a focused retry the turns copied from the first attempt are not scored again; saying
        // "no learner turn asked" about something asked there misled learners (training agent,
        // 7 Oct 2026).
        explanation: !excluded.size ? `No learner turn asked: ${c.description.toLowerCase()}.`
          : c.accepted_intents.some((i) => askedInPrefix.has(i)) ? `Asked in the first attempt, before the retry point; this retry scores only what is asked after it: ${c.description.toLowerCase()}.`
          : `Not asked after the retry point: ${c.description.toLowerCase()}.`,
        method: 'rule', confidence: 0.8, rule_version: RULE_VERSION,
      });
    }
  }
  for (const j of jargon) {
    const t = turns.find((x) => x.id === j.turn_id)!;
    const at = cpIndexOf(t.text.toLowerCase(), j.term.toLowerCase());
    evidence.push({
      id: safeId(`jargon_${j.term}_${evidence.length}`), category: 'conversation', status: 'observed',
      learner_spans: [{ turn_id: t.id, start: at, end: at + cpLength(j.term), quote: cpSlice(t.text, at, at + cpLength(j.term)) }],
      context_spans: [], searched_turn_ids: [], explanation: `Used "${j.term}" without explaining it.`, method: 'rule', confidence: 0.85, rule_version: RULE_VERSION,
    });
  }

  return { evidence, risk_candidates: risk, assessable_learner_turn_ids: assessableIds, asked_by_turn: askedByTurn, unexplained_jargon: jargon, inapplicable_check_ids: inapplicable, cue_turns: cueTurns };
}

/** The cited sentence for a recorded intent: its stored span, else the first sentence that asks something. */
function recordedSentence(text: string, r: RecordedIntent): Sentence {
  const all = sentences(text);
  if (r.start !== undefined && r.end !== undefined) {
    const exact = all.find((s) => s.start <= r.start! && r.end! <= s.end);
    if (exact) return exact;
  }
  return all.find((s) => isQuestion(s.text)) ?? all[0] ?? { text, start: 0, end: cpLength(text) };
}

function firstMatchedWord(rule: RiskRule, sentence: string, example?: string): number {
  // Offset just past the last word the matched example shares with the sentence:
  // a negation anywhere in the clause before that point governs the claim
  // ("approval is NOT guaranteed", "I will NOT promise approval").
  const lower = sentence.toLowerCase();
  let last = 0;
  for (const ex of example ? [example] : rule.examples) for (const w of ex.toLowerCase().match(/[a-z₹]{4,}/g) ?? []) {
    const stemLen = Math.max(4, w.length - 2);
    const at = lower.indexOf(w.slice(0, stemLen));
    if (at >= 0) last = Math.max(last, at + stemLen);
  }
  return cpLength(sentence.slice(0, last));
}

export { CLASSIFIER_VERSION };
