import type { ScenarioBundle } from '../contracts/types';
import { runtimeOf, type Translation } from '../config/runtime-extension';

/**
 * Conversation language for one session.
 *
 * The scenario's source text is the base language ('en'). A scenario may carry
 * translations (extensions.nd_runtime.translations) for Hindi and Marathi; the
 * learner picks one at the start and the whole session, including retries,
 * stays in it. Facts, rules, scoring and the rubric are language-independent:
 * only what the customer says, what the learner reads and the coaching text
 * change. Scores and rubric names stay in English so managers can compare.
 */

export type Language = 'en' | 'hi' | 'mr';
export const LANGUAGES: Language[] = ['en', 'hi', 'mr'];
const BCP47: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const ENGLISH_NAMES: Record<Language, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

export const isLanguage = (x: unknown): x is Language => typeof x === 'string' && (LANGUAGES as string[]).includes(x);
export const bcp47 = (lang: Language) => BCP47[lang];
export const englishName = (lang: Language) => ENGLISH_NAMES[lang];

export function translationOf(bundle: ScenarioBundle, lang: Language): Translation | null {
  return lang === 'en' ? null : runtimeOf(bundle).translations?.[lang] ?? null;
}

/** Languages a learner may choose for this scenario, with their labels and review status. */
export function languagesOf(bundle: ScenarioBundle): { id: Language; label: string; review_status: 'source' | 'draft' | 'reviewed' }[] {
  const out: { id: Language; label: string; review_status: 'source' | 'draft' | 'reviewed' }[] = [{ id: 'en', label: 'English', review_status: 'source' }];
  for (const lang of LANGUAGES) {
    const t = translationOf(bundle, lang);
    if (t) out.push({ id: lang, label: t.label, review_status: t.review_status });
  }
  return out;
}

/** Customer-facing text in the session language, falling back to the source text. */
export function localized(bundle: ScenarioBundle, lang: Language) {
  const t = translationOf(bundle, lang);
  const conv = bundle.conversation;
  const rt = runtimeOf(bundle);
  return {
    opening_text: t?.opening_text ?? conv.opening_text,
    learner_brief: t?.learner_brief ?? bundle.scenario.learner_brief,
    unknown_response: t?.unknown_response ?? conv.unknown_response,
    clarification_response: t?.clarification_response ?? conv.clarification_response,
    acknowledgement_text: t?.acknowledgement_text ?? rt.acknowledgement_text,
    ruleResponse: (ruleId: string, source: string) => t?.rule_responses[ruleId] ?? source,
    cueResponse: (cueId: string, source: string) => t?.cue_responses?.[cueId] ?? source,
    intentExample: (intentId: string) => t?.intent_examples[intentId] ?? conv.intents.find((i) => i.id === intentId)?.positive_examples[0] ?? null,
    retry_lead: t?.retry_lead ?? null,
    reply_instruction: t?.reply_instruction ?? null,
    feedback_instruction: t?.feedback_instruction ?? null,
  };
}
