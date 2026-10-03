import Ajv from 'ajv';
import type { ScenarioBundle, TranscriptTurn, RoleplayCandidate } from '../contracts/types';
import { roleplayCandidateSchema } from '../contracts/schemas';
import { runtimeOf } from '../config/runtime-extension';
import { completeWithRetry, type CompletionResult } from '../providers';
import { renderFact, numbersIn, type DisclosurePlan } from './disclosure';
import { localized, type Language } from './language';
import { sentences, coverage } from './text';

/**
 * Customer turn generation (spec §10, §15).
 *
 * Fixture parts and the unknown/clarification replies are used verbatim. Only
 * fact parts go to the model, which sees nothing but the facts authorised for
 * this turn and those already disclosed. Its output is validated on the server;
 * one retry, then the configured safe reply. Unvalidated output is never shown.
 */

export const OUTPUT_VALIDATOR_VERSION = 'roleplay-output-1.0.0';
const ajv = new Ajv({ allErrors: true, strict: false });
const checkShape = ajv.compile(roleplayCandidateSchema);

export interface GenerationAttempt {
  ok: boolean; reason: string | null; provider: string; model: string;
  request_id: string | null; latency_ms: number; usage: CompletionResult['usage'];
}
export interface CustomerReply {
  text: string;
  /** Facts actually stated to the learner: fixture facts plus validated generated ones. */
  disclosed_fact_ids: string[];
  method: 'fixture' | 'generated' | 'mixed' | 'fallback' | 'configured';
  attempts: GenerationAttempt[];
}

/** Function words that start sentences; never distinctive enough to reveal a hidden fact. */
const COMMON_WORDS = new Set(['the', 'this', 'that', 'these', 'those', 'she', 'her', 'his', 'they', 'their', 'them', 'our', 'you', 'your', 'its', 'has', 'have', 'had', 'does', 'did', 'not', 'some', 'any', 'all', 'about', 'around', 'and', 'but', 'for', 'with', 'from', 'will', 'would', 'can', 'could', 'was', 'were', 'are', 'there', 'here', 'what', 'when', 'who', 'how', 'yes']);

const LEAK = /(allowed_facts|persona_public_style|unknown_response|history_json|system prompt|hidden fact|rubric|evaluator|\bscore\b|as an ai\b|language model|i am an ai)/i;

/** Validate one model candidate against what this turn may say. */
export function validateRoleplayOutput(bundle: ScenarioBundle, raw: string, allowedIds: string[], learnerText: string, history: TranscriptTurn[]): { ok: true; candidate: RoleplayCandidate } | { ok: false; reason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'invalid_json' }; }
  if (!checkShape(parsed)) return { ok: false, reason: 'schema' };
  const c = parsed as unknown as RoleplayCandidate;
  c.text = repairText(c.text);
  const allowed = new Set(allowedIds);
  if (c.used_fact_ids.some((id) => !allowed.has(id))) return { ok: false, reason: 'unauthorised_fact' };
  if (LEAK.test(c.text)) return { ok: false, reason: 'prompt_leakage' };

  const facts = new Map(bundle.facts.map((f) => [f.id, f]));
  const allowedText = [...allowed].map((id) => renderFact(facts.get(id)!) ?? '').join(' ');
  const context = [allowedText, learnerText, bundle.conversation.opening_text, ...history.map((t) => t.text), bundle.persona.name, bundle.scenario.learner_brief].join(' ');

  // Figures: every number must already exist in authorised facts or the conversation.
  const okNumbers = new Set(numbersIn(context));
  if (numbersIn(c.text).some((n) => !okNumbers.has(n))) return { ok: false, reason: 'unsupported_figure' };

  // Hidden facts: a known, unauthorised value must not appear, nor its distinctive words.
  for (const f of bundle.facts) {
    if (allowed.has(f.id) || f.knowledge !== 'known') continue;
    const v = renderFact(f);
    if (!v) continue;
    if (c.text.toLowerCase().includes(v.toLowerCase())) return { ok: false, reason: `hidden_fact:${f.id}` };
    // Capitalised words are treated as names; a fact's sentence-initial function word
    // ("The family has some savings") is not one, and flagging it rejected any reply
    // starting "The …" (live run, 29 Sep 2026).
    for (const w of (v.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((x) => !COMMON_WORDS.has(x.toLowerCase()))) {
      if (c.text.includes(w) && !context.includes(w)) return { ok: false, reason: `hidden_fact:${f.id}` };
    }
  }

  // Named entities: a capitalised word mid-sentence that appears nowhere in the permitted context.
  const known = new Set((context.match(/\b[A-Z][\p{L}]+/gu) ?? []));
  for (const s of c.text.split(/(?<=[.!?])\s+/)) {
    const words = s.match(/\b[A-Z][\p{L}]+/gu) ?? [];
    for (const w of words.slice(s.match(/^[“"']?[A-Z]/) ? 1 : 0)) {
      if (!known.has(w) && !['I', 'EMI', 'OK'].includes(w)) return { ok: false, reason: `unsupported_entity:${w}` };
    }
  }
  return { ok: true, candidate: c };
}

/**
 * A model that writes "don\t" for "don't" produces a JSON tab escape: "I don\t have" became
 * "I don<TAB> have" on screen (live run, 3 Oct 2026). A tab after a letter is that "'t";
 * any other control character is whitespace.
 */
export function repairText(text: string): string {
  return text.replace(/(\p{L})\t(?=\s)/gu, '$1\u2019t').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Generated sentences that only restate a line this same reply already says verbatim are
 * dropped: asked "how much and what is it for?", the reply was the amount fixture followed by
 * the model's retelling of the same amount (live run, 3 Oct 2026).
 */
export function withoutRepeats(generated: string, said: string[]): string {
  if (!said.length) return generated;
  const saidText = said.join(' ');
  const saidNumbers = new Set(numbersIn(saidText));
  const repeats = (t: string) => {
    const c = coverage(t, saidText).score;
    // The same figure in other words ("a loan of ₹4 lakh" after "about ₹4 lakh") is a repeat too.
    const figures = numbersIn(t);
    return c >= 0.8 || (figures.length > 0 && figures.every((n) => saidNumbers.has(n)) && c >= 0.5);
  };
  const kept = sentences(generated).filter((s) => !repeats(s.text)).map((s) => s.text);
  return kept.join(' ');
}

export interface GenerateInput {
  bundle: ScenarioBundle;
  plan: DisclosurePlan;
  history: TranscriptTurn[];
  learnerText: string;
  template: string;
  correlation: { tenant_id: string; session_id: string; operation_id: string };
  language?: Language;
}

export async function generateCustomerReply(input: GenerateInput): Promise<CustomerReply> {
  const { bundle, plan } = input;
  const conv = bundle.conversation;
  const rt = runtimeOf(bundle);
  const factRules = new Map(bundle.conversation.rules.map((r) => [r.id, r]));
  const attempts: GenerationAttempt[] = [];
  // Verbatim lines come from the scenario's translation for the session language (source text otherwise).
  const L = localized(bundle, input.language ?? 'en');

  if (plan.kind === 'clarify') return { text: L.clarification_response, disclosed_fact_ids: [], method: 'configured', attempts };

  const volunteeredFacts = plan.parts.flatMap((p) => (p.kind === 'volunteer' ? p.fact_ids : []));
  const fixtureFacts = plan.parts.flatMap((p) => (p.kind === 'fixture' ? factRules.get(p.rule_id)!.reveal_fact_ids.filter((id) => plan.released_fact_ids.includes(id) || plan.allowed_fact_ids.includes(id)) : []));
  const answerFactIds = plan.parts.flatMap((p) => (p.kind === 'facts' ? p.fact_ids : []));
  const needsModel = plan.kind === 'acknowledge' || answerFactIds.length > 0;

  let generated: string | null = null;
  let generatedFacts: string[] = [];
  let degraded = false;
  let onlyRepeats = false;
  if (needsModel) {
    const facts = new Map(bundle.facts.map((f) => [f.id, f]));
    // The cue is appended verbatim after the answer; the model must not say it too.
    const modelAllowed = plan.allowed_fact_ids.filter((id) => !volunteeredFacts.includes(id));
    const allowedFacts = modelAllowed.map((id) => ({ id, value: renderFact(facts.get(id)!) ?? '', new_this_turn: plan.released_fact_ids.includes(id) }));
    // What the rest of this reply says verbatim, so the model neither repeats nor contradicts it.
    const saidThisTurn = plan.parts.flatMap((p) => (p.kind === 'fixture' ? [L.ruleResponse(p.rule_id, p.text)] : p.kind === 'volunteer' ? [L.cueResponse(p.cue_id, p.text)] : p.kind === 'unknown' ? [L.unknown_response] : []));
    const data = {
      persona_style_json: { name: bundle.persona.name, role: bundle.persona.role, emotion: bundle.persona.initial_emotion, speaking_style: [bundle.persona.speaking_style, L.reply_instruction].filter(Boolean).join(' ') },
      allowed_facts_json: allowedFacts,
      reaction_json: null,
      unknown_response_json: L.unknown_response,
      history_json: [...input.history.map((t) => ({ speaker: t.speaker, text: t.text })), { speaker: 'learner', text: input.learnerText }],
      // Not in the template text; the mock uses them to know what this turn answers.
      answer_fact_ids: answerFactIds,
      acknowledgement_json: L.acknowledgement_text ?? L.clarification_response,
      // roleplay_v2: what this part of the reply is for. "answer" states ANSWER_FACTS; "respond"
      // replies to a message the scenario's facts do not cover, without inventing anything.
      reply_mode_json: answerFactIds.length ? 'answer' : 'respond',
      answer_facts_json: allowedFacts.filter((f) => answerFactIds.includes(f.id)).map(({ id, value }) => ({ id, value })),
      said_this_turn_json: saidThisTurn,
    };
    for (let attempt = 0; attempt < 2 && generated === null; attempt++) {
      try {
        const res = await completeWithRetry({ task: 'roleplay', template: input.template, data, schema: roleplayCandidateSchema, temperature: 0.4, maxTokens: 400, correlation: input.correlation });
        const v = validateRoleplayOutput(bundle, res.text, modelAllowed, input.learnerText, input.history);
        attempts.push({ ok: v.ok, reason: v.ok ? null : v.reason, provider: res.provider, model: res.model, request_id: res.request_id, latency_ms: res.latency_ms, usage: res.usage });
        if (v.ok) {
          generated = withoutRepeats(v.candidate.text, saidThisTurn) || null;
          generatedFacts = generated ? v.candidate.used_fact_ids : [];
          // Everything it said is already in the reply: valid, just nothing to add.
          if (!generated) { onlyRepeats = true; break; }
        }
      } catch (e) {
        attempts.push({ ok: false, reason: `provider:${(e as Error).message.slice(0, 120)}`, provider: 'unknown', model: 'unknown', request_id: null, latency_ms: 0, usage: null });
        // Model unavailable (quota, outage, paused breaker): say the authorised facts
        // plainly, in configured wording, rather than leaving the learner with no reply.
        // Nothing here is invented: each sentence is a fact value the rules released.
        const facts = new Map(bundle.facts.map((f) => [f.id, f]));
        const plain = answerFactIds.map((id) => renderFact(facts.get(id)!)).filter((x): x is string => !!x).map((v) => v.charAt(0).toUpperCase() + v.slice(1)).map((v) => (/[.!?]$/.test(v) ? v : v + '.'));
        generated = plain.length ? plain.join(' ') : (L.acknowledgement_text ?? L.clarification_response);
        generatedFacts = plain.length ? answerFactIds : [];
        degraded = true;
        break;
      }
    }
    if (generated === null && !onlyRepeats) {
      // Two invalid candidates: say nothing unvalidated, release nothing generated.
      const fixtureText = plan.parts.filter((p) => p.kind === 'fixture').map((p) => L.ruleResponse((p as { rule_id: string }).rule_id, (p as { text: string }).text));
      return { text: [...fixtureText, L.clarification_response].join(' '), disclosed_fact_ids: fixtureFacts, method: 'fallback', attempts };
    }
  }

  const pieces: string[] = [];
  let usedGenerated = false;
  for (const p of plan.parts) {
    if (p.kind === 'fixture') pieces.push(L.ruleResponse(p.rule_id, p.text));
    else if (p.kind === 'unknown') pieces.push(L.unknown_response);
    else if (p.kind === 'facts' && !usedGenerated && generated) { pieces.push(generated); usedGenerated = true; }
  }
  // An acknowledgement answers the learner's message first; a due cue follows it.
  if (plan.kind === 'acknowledge' && generated && !usedGenerated) pieces.push(generated);
  // A volunteered cue is the customer's own verbatim line, spoken after the answer.
  for (const p of plan.parts) if (p.kind === 'volunteer') pieces.push(L.cueResponse(p.cue_id, p.text));
  const hasFixture = plan.parts.some((p) => p.kind === 'fixture' || p.kind === 'volunteer');
  const method = degraded ? 'fallback' : generated ? (hasFixture ? 'mixed' : 'generated') : hasFixture ? 'fixture' : 'configured';
  return { text: pieces.join(' '), disclosed_fact_ids: Array.from(new Set([...fixtureFacts, ...volunteeredFacts, ...generatedFacts.filter((id) => plan.released_fact_ids.includes(id) || plan.allowed_fact_ids.includes(id))])), method, attempts };
}
