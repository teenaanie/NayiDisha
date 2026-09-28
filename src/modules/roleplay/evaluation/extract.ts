import type { ScenarioBundle, TranscriptTurn, Evidence, Span, RiskRule } from '../contracts/types';
import { runtimeOf } from '../config/runtime-extension';
import { classify, CLASSIFIER_VERSION } from '../runtime/intents';
import { discoveryComplete } from '../runtime/disclosure';
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

export const RULE_VERSION = 'rules-1.0.0';

export interface RiskCandidate { rule_id: string; evidence_id: string; turn_id: string; sentence: string; similarity: number }
export interface RuleEvidence {
  evidence: Evidence[];
  risk_candidates: RiskCandidate[];
  /** Learner turns the evaluator may credit (focused retries exclude the cloned prefix). */
  assessable_learner_turn_ids: string[];
  /** Intents asked per learner turn, in order; drives the discovery gate. */
  asked_by_turn: { turn_id: string; intents: string[] }[];
  unexplained_jargon: { term: string; turn_id: string }[];
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

export function extractRuleEvidence(bundle: ScenarioBundle, turns: TranscriptTurn[], opts: { excludeOrigins?: TranscriptTurn['origin'][] } = {}): RuleEvidence {
  const rt = runtimeOf(bundle);
  const excluded = new Set(opts.excludeOrigins ?? []);
  const learner = turns.filter((t) => t.speaker === 'learner');
  const assessable = learner.filter((t) => !excluded.has(t.origin));
  const assessableIds = assessable.map((t) => t.id);
  const evidence: Evidence[] = [];
  const risk: RiskCandidate[] = [];
  const asked = new Set<string>();
  const askedByTurn: RuleEvidence['asked_by_turn'] = [];
  const observed = new Map<string, Span[]>();   // check_id -> spans

  // ---- coverage: which checks did the learner actually ask about? ----------
  const checksByIntent = new Map<string, string[]>();
  for (const c of bundle.rubric.checks) {
    if (c.credit_requires !== 'learner_question') continue;
    for (const i of c.accepted_intents) checksByIntent.set(i, [...(checksByIntent.get(i) ?? []), c.id]);
  }
  for (const t of learner) {
    const cls = classify(bundle, t.text, { discoveryComplete: discoveryComplete(bundle, asked) });
    const intents: string[] = [];
    for (const h of cls.hits) {
      if (!h.question) continue;
      intents.push(h.intent_id);
      if (excluded.has(t.origin)) continue;   // prefix turns set context, never earn credit
      for (const cid of checksByIntent.get(h.intent_id) ?? []) {
        const spans = observed.get(cid) ?? [];
        if (!spans.some((s) => s.turn_id === t.id && s.start === h.sentence.start)) spans.push(spanOf(t, h.sentence));
        observed.set(cid, spans);
      }
    }
    intents.forEach((i) => asked.add(i));
    askedByTurn.push({ turn_id: t.id, intents });

    // ---- risk candidates ---------------------------------------------------
    if (excluded.has(t.origin)) continue;
    const gateOpen = !discoveryComplete(bundle, new Set(askedByTurn.slice(0, -1).flatMap((x) => x.intents)));
    for (const s of sentences(t.text)) {
      for (const rule of bundle.risk_policy.rules) {
        if (rule.detector === 'semantic') continue;          // needs the model; no rule candidate
        if (rt.discovery_conditioned.includes(rule.id) && !gateOpen) continue;
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
    } else if (c.credit_requires === 'learner_question' || rt.check_cues[c.id]) {
      evidence.push({
        id: safeId(`ev_${c.id}`), category: c.category, check_id: c.id, status: 'not_observed',
        learner_spans: [], context_spans: [], searched_turn_ids: assessableIds,
        explanation: `No learner turn ${c.credit_requires === 'learner_question' ? 'asked' : 'showed'}: ${c.description.toLowerCase()}.`,
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

  return { evidence, risk_candidates: risk, assessable_learner_turn_ids: assessableIds, asked_by_turn: askedByTurn, unexplained_jargon: jargon };
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
