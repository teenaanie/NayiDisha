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

export const CLASSIFIER_VERSION = 'lexical-1.0.0';
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
  // its topic words are an extra example, never the only one when examples exist.
  const topic = intent.description.replace(DESCRIPTION_NOISE, ' ');
  return [...intent.positive_examples, topic];
}

function scoreIntent(intent: Intent, text: string): number {
  let best = 0;
  for (const ex of examplesOf(intent)) {
    const c = coverage(ex, text);
    // A one-word match on a long example is noise; require two words unless the example only has one or two.
    const needed = Math.min(2, c.total);
    if (c.matched >= needed) best = Math.max(best, c.score);
  }
  for (const neg of intent.negative_examples) {
    // Negative examples reject a match only when they fit the sentence better than any positive one.
    const c = coverage(neg, text);
    if (c.total >= 3 && c.score >= 0.8 && c.score > best) return 0;
  }
  return best;
}

export interface ClassifyContext { discoveryComplete: boolean }

export function classify(bundle: ScenarioBundle, text: string, ctx: ClassifyContext): Classification {
  const rt = runtimeOf(bundle);
  const hits: IntentHit[] = [];
  let partial = false;
  let asks = false;
  for (const s of sentences(text)) {
    const q = isQuestion(s.text);
    asks ||= q;
    const scored: { id: string; score: number }[] = [];
    for (const intent of bundle.conversation.intents) {
      const questionFree = rt.question_free_intents.includes(intent.id);
      if (!q && !questionFree) continue;
      if (rt.discovery_conditioned.includes(intent.id) && ctx.discoveryComplete) continue;
      const score = scoreIntent(intent, s.text);
      if (score >= ACCEPT) scored.push({ id: intent.id, score });
      else if (score >= PARTIAL && q) partial = true;
    }
    // A sentence asks one thing: keep the best match (and exact ties), not every
    // neighbouring topic that shares a word ("repayment" comfort vs expectations).
    const top = Math.max(0, ...scored.map((x) => x.score));
    for (const x of scored.filter((y) => top - y.score < 0.05)) {
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
