import { customerModel, evaluatorModel, parseJsonObject } from '@/modules/adapters/llm';
import { sarvamConfigured, sarvamTranslate, LANGUAGE_NAMES, type SarvamLanguage } from '@/modules/adapters/sarvam';
import {
  ruleCustomerReply, gatherEvidence, ruleScores, reconcile, ruleReport, bandFor, pick, hasHardRisk,
  isPitch, isQuestion, DISCOVERY_BEFORE_PITCH,
  type Scenario, type Turn, type Lang, type CustomerReply, type DimensionScore, type Report, type Evidence,
} from './rules';

/**
 * The two model-backed agents. They are deliberately separate: the customer
 * aims for realism and never judges; the evaluator never sees the customer's
 * instructions and grades only what the learner did. Each degrades to the
 * rules in rules.ts, so a model outage never strands a learner mid-practice.
 */

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

function customerSystemPrompt(s: Scenario, lang: Lang, revealed: string[], askedSoFar: number): string {
  const p = s.customerProfile;
  const facts = s.facts.map((f) =>
    `- ${f.key}${revealed.includes(f.key) ? ' (ALREADY SHARED)' : ''}: ${f.value}. Share only when: ${f.reveal_when}`).join('\n');
  return [
    `You are role-playing ${p.name}, ${p.relationship}, in a sales-training simulation for ${s.product}.`,
    `The learner plays a ${s.learnerRole}. Your mood: ${p.initial_mood}. Your main concern: ${p.main_concern}.`,
    `A worry you keep to yourself unless the learner explores your feelings: ${p.hidden_concern}.`,
    '',
    'Facts you know. Reveal each one ONLY when its condition is met by what the learner just asked:',
    facts,
    '',
    'Rules:',
    '- Stay in character as a real, slightly cautious parent. Never say you are an AI or a simulation.',
    '- Answer only what was asked. Give partial answers. Never volunteer several facts at once.',
    '- Never coach the learner, suggest what they should ask, or evaluate them.',
    `- If the learner starts pitching a product, rates or documents before understanding your situation (they have asked about ${askedSoFar} of your circumstances so far; fewer than 4 is too early), reply with: "${pick(s.pitchDeflection, lang)}" and set learner_pitched_early to true.`,
    '- If the learner promises approval or pressures you, become more hesitant.',
    `- Reply in ${LANGUAGE_NAMES[lang as SarvamLanguage] ?? 'English'} only, in one to three short spoken sentences.`,
    '',
    'Return ONLY JSON: {"reply": "<what you say>", "revealed_keys": [<fact keys you revealed in this reply>], "learner_pitched_early": <true|false>}',
  ].join('\n');
}

export async function customerTurn(
  s: Scenario, lang: Lang, history: Turn[], learner: Turn, revealed: string[], askedSoFar: number,
): Promise<CustomerReply & { agent: string }> {
  const rules = () => ({ ...ruleCustomerReply(s, lang, learner, revealed, askedSoFar, history.length), agent: 'rules@1' });
  // An early pitch always gets the scenario's own line. Left to a model, the
  // customer tends to be helpful and hint at what to ask next, which is coaching.
  if (isPitch(learner) && !isQuestion(learner) && askedSoFar < DISCOVERY_BEFORE_PITCH) return rules();
  const model = customerModel();
  if (!model) return rules();
  try {
    const text = await model.complete([
      { role: 'system', content: customerSystemPrompt(s, lang, revealed, askedSoFar) },
      ...history.map((t) => ({ role: t.speaker === 'LEARNER' ? 'user' as const : 'assistant' as const, content: t.text })),
      { role: 'user', content: learner.text },
    ], { temperature: 0.5, json: true, maxTokens: 700 });
    const parsed = parseJsonObject(text);
    const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) return rules();
    const valid = new Set(s.facts.map((f) => f.key));
    const keys = Array.isArray(parsed?.revealed_keys)
      ? parsed!.revealed_keys.filter((k): k is string => typeof k === 'string' && valid.has(k) && !revealed.includes(k))
      : [];
    return { reply: reply.slice(0, 800), revealedKeys: keys, pitchedEarly: parsed?.learner_pitched_early === true, agent: model.name };
  } catch {
    return rules();
  }
}

// ---------------------------------------------------------------------------
// Translation for the evaluator
// ---------------------------------------------------------------------------

/** English rendering for evaluation, or null when no translator is available. */
export async function toEnglish(text: string, lang: Lang): Promise<string | null> {
  if (lang === 'en') return text;
  if (!sarvamConfigured()) return null;
  try { return await sarvamTranslate(text, lang as SarvamLanguage, 'en'); } catch { return null; }
}

export async function fromEnglish(text: string, lang: Lang): Promise<string> {
  if (lang === 'en' || !sarvamConfigured() || !text) return text;
  try { return (await sarvamTranslate(text, 'en', lang as SarvamLanguage)) || text; } catch { return text; }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface Evaluation extends Report {
  overall: number;
  maxScore: number;
  band: string;
  dimensions: DimensionScore[];
  evidence: Evidence;
  evaluator: string;
  confidence: number;
  needsReview: boolean;
}

function evaluatorPrompt(s: Scenario, turns: Turn[], ev: Evidence): string {
  const rubric = s.rubric.map((d, i) =>
    `${i + 1}. ${d.key} — ${d.label}\n   5: ${d.excellent}\n   3: ${d.acceptable}\n   1: ${d.poor}`).join('\n');
  const transcript = turns.map((t) =>
    `[${t.seq}] ${t.speaker === 'LEARNER' ? 'LEARNER' : 'CUSTOMER'}: ${t.textEn ?? t.text}`).join('\n');
  return [
    `You are an assessment evaluator for a ${s.product} sales simulation. Skill tested: ${s.skill}.`,
    `Scenario brief given to the learner: ${s.learnerBrief.en}`,
    '',
    'Evaluate only the learner\'s performance using the rubric.',
    'Do not reward the learner for information the customer gave unless the learner asked for it.',
    'Score only observable behaviours from the transcript. Penalise guaranteed approval, misleading claims, or premature pitching.',
    'Integer scores 1-5; 2 and 4 are allowed between the described levels.',
    '',
    'Rubric:',
    rubric,
    '',
    'Checks already made by rules (treat as fact):',
    `- Areas the learner asked about: ${ev.coverage.filter((c) => c.asked).map((c) => c.key).join(', ') || 'none'}`,
    `- Areas missed: ${ev.coverage.filter((c) => !c.asked).map((c) => c.key).join(', ') || 'none'}`,
    `- Pitched before discovery: ${ev.pitchedEarly ? 'yes' : 'no'}`,
    `- Compliance risk statements: ${ev.riskFlags.map((f) => `${f.label} (turn ${f.turnSeq})`).join('; ') || 'none'}`,
    '',
    'Transcript:',
    transcript,
    '',
    'Return ONLY JSON:',
    '{"dimension_scores":[{"dimension":"<rubric key>","score":<1-5>,"evidence":"<one sentence citing what the learner said or failed to ask>"}],',
    ' "strengths":["<second person, specific>"], "improvement_areas":["<second person, specific>"],',
    ' "best_moment":"<quote the learner\'s strongest line and say why>", "missed_opportunity":"<a moment and the exact question they could have asked>",',
    ' "suggested_retry":"<one instruction for the next attempt>", "confidence":<0-1>}',
  ].join('\n');
}

const strings = (v: unknown, max = 5) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, max).map((x) => x.slice(0, 400)) : [];

export async function evaluate(s: Scenario, turns: Turn[], lang: Lang): Promise<Evaluation> {
  const ev = gatherEvidence(s, turns);
  const rule = ruleScores(s, ev);
  const baseReport = ruleReport(s, ev, rule, turns);
  let dims = rule;
  let report: Report = baseReport;
  let evaluator = 'rules@1';
  let confidence = 0.5;
  // A transcript the evaluator could not read in English is graded by rules
  // only rather than by a model guessing at a language it was not given.
  const readable = turns.every((t) => t.textEn !== null);

  const model = evaluatorModel();
  if (model && readable && ev.learnerTurns > 0) {
    try {
      const ask = () => model.complete([{ role: 'user', content: evaluatorPrompt(s, turns, ev) }], { temperature: 0, json: true, maxTokens: 1500 });
      // Free tiers limit per minute, so a burst fails; one retry after a pause clears it.
      const text = await ask().catch(async () => { await new Promise((r) => setTimeout(r, 3500)); return ask(); });
      const parsed = parseJsonObject(text);
      const raw = Array.isArray(parsed?.dimension_scores) ? parsed!.dimension_scores as any[] : null;
      if (raw) {
        const modelDims: DimensionScore[] = s.rubric.flatMap((d) => {
          const m = raw.find((x) => x?.dimension === d.key || x?.dimension === d.label);
          return m && typeof m.score === 'number'
            ? [{ key: d.key, label: d.label, score: m.score, evidence: typeof m.evidence === 'string' ? m.evidence.slice(0, 400) : '' }]
            : [];
        });
        if (modelDims.length !== s.rubric.length) console.warn(`evaluator ${model.name}: incomplete rubric in response; using rules`);
        if (modelDims.length === s.rubric.length) {
          dims = reconcile(rule, modelDims, s, ev);
          evaluator = model.name;
          confidence = typeof parsed?.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;
          const strengths = strings(parsed?.strengths);
          const improvements = strings(parsed?.improvement_areas);
          report = {
            strengths: strengths.length ? strengths : baseReport.strengths,
            improvements: improvements.length ? improvements : baseReport.improvements,
            bestMoment: typeof parsed?.best_moment === 'string' && parsed.best_moment.trim() ? parsed.best_moment.slice(0, 400) : baseReport.bestMoment,
            missedOpportunity: typeof parsed?.missed_opportunity === 'string' && parsed.missed_opportunity.trim() ? parsed.missed_opportunity.slice(0, 400) : baseReport.missedOpportunity,
            retry: {
              ...baseReport.retry,
              instruction: typeof parsed?.suggested_retry === 'string' && parsed.suggested_retry.trim() ? parsed.suggested_retry.slice(0, 400) : baseReport.retry.instruction,
            },
          };
        }
      }
    } catch (e) {
      // Rules stand, and the evaluation is flagged for review; say why in the log.
      console.warn(`evaluator ${model.name} failed; using rules:`, e instanceof Error ? e.message : e);
    }
  }

  const overall = dims.reduce((n, d) => n + d.score, 0);
  const maxScore = s.rubric.length * 5;
  // The learner reads the report in their own language; stored evidence stays English for operations.
  if (lang !== 'en') {
    report = {
      strengths: await Promise.all(report.strengths.map((x) => fromEnglish(x, lang))),
      improvements: await Promise.all(report.improvements.map((x) => fromEnglish(x, lang))),
      bestMoment: report.bestMoment ? await fromEnglish(report.bestMoment, lang) : null,
      missedOpportunity: report.missedOpportunity ? await fromEnglish(report.missedOpportunity, lang) : null,
      retry: { ...report.retry, instruction: await fromEnglish(report.retry.instruction, lang) },
    };
  }
  return {
    ...report, overall, maxScore, dimensions: dims, evidence: ev,
    // A total can look healthy around a promise of approval; the band must not.
    band: bandFor(s, overall) + (hasHardRisk(ev) ? ' · compliance risk' : ''),
    evaluator, confidence,
    needsReview: evaluator === 'rules@1' || confidence < 0.6 || ev.riskFlags.length > 0,
  };
}
