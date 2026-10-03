import type { ScenarioBundle, TranscriptTurn } from '../contracts/types';
import { classify, CLASSIFIER_VERSION, type Classification } from './intents';
import { classifyWithModel, modelClassifierAvailable } from './model-classifier';
import { resolveDisclosure, discoveryComplete, type DisclosurePlan } from './disclosure';
import { generateCustomerReply, OUTPUT_VALIDATOR_VERSION, type CustomerReply } from './generate';
import type { Language } from './language';

/**
 * One customer turn, start to finish, with no I/O beyond the model call.
 * The session service persists what this returns; tests call it directly.
 */
export interface TurnInput {
  bundle: ScenarioBundle;
  history: TranscriptTurn[];
  learnerText: string;
  disclosed: Set<string>;
  /** Every intent the learner has asked so far (drives the discovery gate). */
  askedIntentIds: Set<string>;
  template: string;
  correlation: { tenant_id: string; session_id: string; operation_id: string };
  /** Conversation language; the customer replies in it. Default English. */
  language?: Language;
}
export interface TurnOutput {
  classification: Classification;
  plan: DisclosurePlan;
  reply: CustomerReply;
  engine: { classifier_version: string; output_validator_version: string; classifier_fallback: string | null };
}

export async function respond(input: TurnInput): Promise<TurnOutput> {
  const done = discoveryComplete(input.bundle, input.askedIntentIds);
  // A live model understands paraphrases and multi-part questions; the phrase
  // matcher is the fallback, so a model outage never stops the conversation.
  let classification: Classification = classify(input.bundle, input.learnerText, { discoveryComplete: done });
  let classifierFallback: string | null = null;
  if (modelClassifierAvailable()) {
    try {
      const lastCustomer = [...input.history].reverse().find((t) => t.speaker === 'customer')?.text ?? '';
      const previousLearner = [...input.history].reverse().find((t) => t.speaker === 'learner')?.text ?? '';
      classification = await classifyWithModel(input.bundle, input.learnerText, lastCustomer, done, input.correlation, previousLearner);
    } catch (e) {
      classifierFallback = (e as Error).message.slice(0, 120);
    }
  }
  // Learner messages so far, including this one: drives when the customer volunteers a cue.
  const learnerTurnIndex = input.history.filter((t) => t.speaker === 'learner').length + 1;
  const plan = resolveDisclosure(input.bundle, classification, input.disclosed, { learnerTurnIndex });
  const reply = await generateCustomerReply({ bundle: input.bundle, plan, history: input.history, learnerText: input.learnerText, template: input.template, correlation: input.correlation, language: input.language ?? 'en' });
  return { classification, plan, reply, engine: { classifier_version: classification.classifier_version, output_validator_version: OUTPUT_VALIDATOR_VERSION, classifier_fallback: classifierFallback } };
}

export const ENGINE_VERSION = `engine-1.0.0/${CLASSIFIER_VERSION}/${OUTPUT_VALIDATOR_VERSION}`;
