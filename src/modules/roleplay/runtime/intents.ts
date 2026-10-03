import type { ScenarioBundle, Intent } from '../contracts/types';
import { runtimeOf } from '../config/runtime-extension';
import { sentences, isQuestion, coverage, contentWords, type Sentence } from './text';

/**
 * Deterministic intent classifier (spec §10).
 *
 * Matches each sentence of a learner turn against an intent's configured
 * examples and its description. It only ever returns configured intent IDs and
 * never decides a score. An intent that disclosure rules answer requires the
 * sentence to *ask* something, so mentioning a topic is not asking about it
 * (AT06); intents listed in `question_free_intents` (a pitch) match statements.
 *
 * This is the "unambiguous supported phrases" half of the spec's classifier.
 * A live semantic classifier can replace it through the provider interface;
 * its output is filtered to configured IDs the same way.
 */

export const CLASSIFIER_VERSION = 'lexical-1.2.0';
export const ACCEPT = 0.6;
export const PARTIAL = 0.34;

export interface IntentHit { intent_id: string; confidence: number; sentence: Sentence; question: boolean }
export interface Classification {
  hits: IntentHit[];
  /** Something looked close but nothing cleared the bar: ask for clarification, release nothing. */
  low_confidence: boolean;
  asks_anything: boolean;
  classifier_version: string;
}

const DESCRIPTION_NOISE = /\b(detect|learner|question|about|premature|conditioned|on|discovery|state)\b/gi;

function examplesOf(intent: Intent): string[] {
  // The description names the topic ("... a learner question about fee deadline.");
  // its topic words are an extra example, never the only one when examples exist. A bracketed
  // aside says what the intent is NOT ("not when the customer can provide documents"); its
  // words must not become evidence for it.
  const topic = intent.description.replace(/\([^)]*\)/g, ' ').replace(DESCRIPTION_NOISE, ' ');
  return [...intent.positive_examples, topic];
}

/** Best coverage of the sentence by one of the intent's examples, and how many words that match used. */
function scoreIntent(intent: Intent, text: string): { score: number; matched: number } {
  let best = { score: 0, matched: 0 };
  for (const ex of examplesOf(intent)) {
    const c = coverage(ex, text);
    // A one-word match on a long example is noise; require two words unless the example only has one or two.
    const needed = Math.min(2, c.total);
    if (c.matched >= needed && (c.score > best.score || (c.score === best.score && c.matched > best.matched))) best = { score: c.score, matched: c.matched };
  }
  for (const neg of intent.negative_examples) {
    // Negative examples reject a match only when they fit the sentence better than any positive one.
    const c = coverage(neg, text);
    if (c.total >= 3 && c.score >= 0.8 && c.score > best.score) return { score: 0, matched: 0 };
  }
  return best;
}

export interface ClassifyContext { discoveryComplete: boolean }

/**
 * "When is the fee due and how much is it?" asks two things. Split a sentence
 * where a conjunction introduces a new question word, keeping code-point
 * offsets so evidence spans still point into the original text.
 */
const CLAUSE_BREAK = /\s*(?:,\s*)?\b(?:and|also|plus)\s+(?=(?:what|whats|what's|when|where|who|which|how|is|are|do|does|did|can|could|will|would|has|have)\b)/gi;
export function clauses(s: Sentence): Sentence[] {
  const cps = Array.from(s.text);
  const unitToCp = (u: number) => Array.from(s.text.slice(0, u)).length;
  const bounds: [number, number][] = [];
  let last = 0;
  for (const m of s.text.matchAll(CLAUSE_BREAK)) {
    bounds.push([last, unitToCp(m.index!)]);
    last = unitToCp(m.index! + m[0].length);
  }
  if (!bounds.length) return [s];
  bounds.push([last, cps.length]);
  // Exact slices (whitespace trimmed by offset), so a quote still matches the transcript.
  return bounds.flatMap(([a, b]) => {
    while (a < b && /\s/.test(cps[a])) a++;
    while (b > a && /\s/.test(cps[b - 1])) b--;
    return b > a ? [{ text: cps.slice(a, b).join(''), start: s.start + a, end: s.start + b }] : [];
  });
}

export function classify(bundle: ScenarioBundle, text: string, ctx: ClassifyContext): Classification {
  const rt = runtimeOf(bundle);
  const hits: IntentHit[] = [];
  let partial = false;
  let asks = false;
  for (const whole of sentences(text)) for (const s of clauses(whole)) {
    // A clause of a question sentence is part of that question.
    const q = isQuestion(s.text) || isQuestion(whole.text);
    asks ||= q;
    const scored: { id: string; score: number; matched: number }[] = [];
    for (const intent of bundle.conversation.intents) {
      const questionFree = rt.question_free_intents.includes(intent.id);
      if (!q && !questionFree) continue;
      if (rt.discovery_conditioned.includes(intent.id) && ctx.discoveryComplete) continue;
      const { score, matched } = scoreIntent(intent, s.text);
      if (score >= ACCEPT) scored.push({ id: intent.id, score, matched });
      else if (score >= PARTIAL && q) partial = true;
    }
    // A sentence asks one thing: keep the best match (and exact ties), not every
    // neighbouring topic that shares a word ("repayment" comfort vs expectations).
    // Between equally good matches, the more specific one wins: "What matters most to you in
    // this loan?" fully matches a 4-word priorities example and the 2-word "What do you need
    // the loan for?"; only the first is what was asked.
    const top = Math.max(0, ...scored.map((x) => x.score));
    const ties = scored.filter((y) => top - y.score < 0.05);
    const most = Math.max(0, ...ties.map((x) => x.matched));
    for (const x of ties.filter((y) => y.matched === most || y.matched >= 3)) {
      const confidence = Math.round(x.score * 100) / 100;
      const prior = hits.find((h) => h.intent_id === x.id);
      if (!prior) hits.push({ intent_id: x.id, confidence, sentence: s, question: q });
      else if (confidence > prior.confidence) Object.assign(prior, { confidence, sentence: s, question: q });
    }
  }
  // Question-free intents (a pitch) do not suppress an otherwise plain statement's acknowledgement.
  return { hits, low_confidence: !hits.length && partial, asks_anything: asks, classifier_version: CLASSIFIER_VERSION };
}

/** For diagnostics and the builder preview: which words an intent listens for. */
export function intentVocabulary(intent: Intent): string[] {
  return Array.from(new Set(examplesOf(intent).flatMap((e) => contentWords(e))));
}
