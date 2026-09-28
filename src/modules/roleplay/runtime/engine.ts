import type { ScenarioBundle, TranscriptTurn } from '../contracts/types';
import { classify, CLASSIFIER_VERSION, type Classification } from './intents';
import { resolveDisclosure, discoveryComplete, type DisclosurePlan } from './disclosure';
import { generateCustomerReply, OUTPUT_VALIDATOR_VERSION, type CustomerReply } from './generate';

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
}
export interface TurnOutput {
  classification: Classification;
  plan: DisclosurePlan;
  reply: CustomerReply;
  engine: { classifier_version: string; output_validator_version: string };
}

export async function respond(input: TurnInput): Promise<TurnOutput> {
  const classification = classify(input.bundle, input.learnerText, { discoveryComplete: discoveryComplete(input.bundle, input.askedIntentIds) });
  const plan = resolveDisclosure(input.bundle, classification, input.disclosed);
  const reply = await generateCustomerReply({ bundle: input.bundle, plan, history: input.history, learnerText: input.learnerText, template: input.template, correlation: input.correlation });
  return { classification, plan, reply, engine: { classifier_version: CLASSIFIER_VERSION, output_validator_version: OUTPUT_VALIDATOR_VERSION } };
}

export const ENGINE_VERSION = `engine-1.0.0/${CLASSIFIER_VERSION}/${OUTPUT_VALIDATOR_VERSION}`;
