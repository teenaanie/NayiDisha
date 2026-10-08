import Ajv from 'ajv';
import { localized, type Language } from '../runtime/language';
import type { CoachingCandidate, Evidence, EvaluationCandidate, ScenarioBundle, TranscriptTurn, Finding } from '../contracts/types';
import { coachingCandidateSchema } from '../contracts/schemas';
import { runtimeOf } from '../config/runtime-extension';
import { VOLUNTEERED } from '../evaluation/extract';
import type { CoachInput } from './mock-coach';

/**
 * Coaching (spec §20).
 *
 * The coach may only rephrase verified findings. Its output is rejected if a
 * finding cites evidence the assessment does not contain, if it quotes words
 * the learner never said; improvements beyond the first three are dropped.
 */

export const COACH_SCHEMA_VERSION = 'coaching-report-1.0';
export const NO_RISK_TEXT = 'No configured risk detected in this transcript.';
const ajv = new Ajv({ allErrors: true, strict: false });
const checkShape = ajv.compile(coachingCandidateSchema);

/**
 * What each piece of evidence means for the learner, decided on the server so the
 * coach cannot misread it. For an absence check ("avoids guarantees") `not_observed`
 * is the good result; for everything else it is a gap (live reports, 29 Sep 2026,
 * listed "did not explain jargon" when none was used, and praised a one-question
 * attempt for "avoiding a pitch").
 */
export type Outcome = 'met' | 'missed' | 'violated' | 'unclear' | 'other';
/**
 * The model sometimes marks a judgement-only check "uncertain" while its own explanation affirms
 * it ("The conversation remained focused on the loan requirement throughout."; 7 Oct 2026). With
 * no quote to weigh and plainly positive words with no hedge, that is a met behaviour.
 */
const AFFIRM = /\b(remained|kept|stayed|consistently|successfully|clearly|throughout|maintained|well)\b/i;
const HEDGE = /\b(not|no|never|didn['’]t|did not|unclear|uncertain|cannot|can['’]t|could not|insufficient|partially|partly|some|somewhat|limited|may|might|unsure|difficult|without|lack|lacked|missed|however|but|although|though|only)\b/i;
export function affirmsWithoutQuote(e: { method: string; learner_spans: unknown[]; explanation: string }): boolean {
  return e.method === 'llm' && e.learner_spans.length === 0 && AFFIRM.test(e.explanation) && !HEDGE.test(e.explanation);
}

export function evidenceOutcomes(bundle: ScenarioBundle, candidate: EvaluationCandidate): Map<string, Outcome> {
  const absence = runtimeOf(bundle).absence_checks;
  const out = new Map<string, Outcome>();
  for (const e of candidate.evidence) {
    if (!e.check_id) { out.set(e.id, e.status === 'observed' || e.status === 'contradicted' ? 'violated' : 'other'); continue; }
    if (e.status === 'uncertain' && e.method === 'rule' && e.explanation.startsWith(VOLUNTEERED)) out.set(e.id, 'other');   // answered unasked: neither met nor a gap
    else if (e.status === 'uncertain') out.set(e.id, affirmsWithoutQuote(e) ? 'met' : 'unclear');
    // For an absence check the evaluator reports a violation as `contradicted`; `observed` affirms
    // the good behaviour ("used simple language", with a quote) and `not_observed` means none seen.
    else if (e.check_id in absence) out.set(e.id, e.status === 'contradicted' ? 'violated' : 'met');
    else out.set(e.id, e.status === 'observed' ? 'met' : e.status === 'contradicted' ? 'violated' : 'missed');
  }
  return out;
}

/** "Top 3 questions that were missed" (owner's report format). */
export const MAX_MISSED_QUESTIONS = 3;
const LIST_CAPS: Record<string, number> = Object.fromEntries(
  Object.entries((coachingCandidateSchema as { properties: Record<string, { maxItems?: number }> }).properties)
    .filter(([, v]) => typeof v?.maxItems === 'number').map(([k, v]) => [k, v.maxItems!]));

/**
 * Missed questions in priority order: the evaluation guide's framework order when the
 * scenario has one, otherwise rubric check order. The report keeps the first three.
 */
export function orderMissedQuestions(bundle: ScenarioBundle, candidate: EvaluationCandidate, findings: Finding[]): Finding[] {
  const order = runtimeOf(bundle).evaluation_guide?.framework.map((a) => a.check_id) ?? bundle.rubric.checks.map((c) => c.id);
  const checkOf = new Map(candidate.evidence.map((e) => [e.id, e.check_id]));
  const rank = (f: Finding) => Math.min(...f.evidence_ids.map((id) => { const i = order.indexOf(checkOf.get(id) ?? ''); return i < 0 ? order.length : i; }), order.length);
  return [...findings].map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

/** Evidence for discovery-question (coverage) checks: the only kind a "missed question" may cite. */
export function coverageEvidenceIds(bundle: ScenarioBundle, candidate: EvaluationCandidate): Set<string> {
  const cov = new Set(bundle.rubric.checks.filter((c) => c.category === 'coverage').map((c) => c.id));
  return new Set(candidate.evidence.filter((e) => e.check_id && cov.has(e.check_id)).map((e) => e.id));
}
export const MAX_RETRY_TARGETS = 3;

/**
 * Focused-retry targets from this learner's own gaps: coverage checks they missed,
 * weakest dimension first, at most three. The scenario's configured targets are the
 * fallback when nothing was missed (they were used for everyone before 29 Sep 2026).
 */
export function personalRetryTargets(bundle: ScenarioBundle, candidate: EvaluationCandidate): { check_ids: string[]; personal: boolean } {
  const outcomes = evidenceOutcomes(bundle, candidate);
  const missed = new Set(candidate.evidence.filter((e) => e.check_id && outcomes.get(e.id) === 'missed').map((e) => e.check_id!));
  const score = new Map(candidate.dimension_scores.map((d) => [d.dimension_id, d.score]));
  const dims = [...bundle.rubric.dimensions].sort((a, b) => (score.get(a.id) ?? 0) / a.max_score - (score.get(b.id) ?? 0) / b.max_score);
  const checks = new Map(bundle.rubric.checks.map((c) => [c.id, c]));
  const picked: string[] = [];
  for (const d of dims) for (const id of d.check_ids) {
    if (picked.length < MAX_RETRY_TARGETS && missed.has(id) && checks.get(id)?.category === 'coverage' && !picked.includes(id)) picked.push(id);
  }
  return picked.length ? { check_ids: picked, personal: true } : { check_ids: [...bundle.retry.focused_target_check_ids], personal: false };
}

export function retryInstruction(bundle: ScenarioBundle, targetCheckIds: string[], personal: boolean, lang: Language = 'en'): string {
  const L = localized(bundle, lang);
  if (!personal) return bundle.retry.instruction;
  const checks = new Map(bundle.rubric.checks.map((c) => [c.id, c]));
  const ask = targetCheckIds.map((id) => {
    const c = checks.get(id)!;
    const ex = c.accepted_intents.map((i) => L.intentExample(i)).find(Boolean);
    return ex ? `“${ex}”` : c.description.replace(/^./, (x) => x.toLowerCase());
  });
  return `${L.retry_lead ?? 'Repeat the middle part of the conversation. This time, find out what you missed before explaining any product. For example:'} ${ask.join(' ')}`;
}

export function buildCoachInput(bundle: ScenarioBundle, candidate: EvaluationCandidate, mode: 'full' | 'focused', targetCheckIds: string[], retryOptions: unknown, turns: TranscriptTurn[] = [], lang: Language = 'en'): CoachInput {
  const rt = runtimeOf(bundle);
  const outcomes = evidenceOutcomes(bundle, candidate);
  const L = localized(bundle, lang);
  const exampleFor = (intentIds: string[]) => {
    for (const id of intentIds) {
      const ex = L.intentExample(id);
      if (ex) return ex;
    }
    return null;
  };
  return {
    assessment_json: {
      mode,
      target_check_ids: targetCheckIds,
      dimensions: candidate.dimension_scores.map((d) => {
        const def = bundle.rubric.dimensions.find((x) => x.id === d.dimension_id)!;
        return { id: d.dimension_id, name: def.name, score: d.score, max: def.max_score, rationale: d.rationale, anchor: def.anchors.find((a) => a.score === d.score)?.description ?? '', evidence_ids: d.evidence_ids,
          ...(d.coaching ? { coaching: d.coaching } : {}), ...(bundle.scoring.mode === 'weighted_percent' ? { weight: bundle.scoring.weights[d.dimension_id] } : {}) };
      }),
      evidence: candidate.evidence.map((e) => ({ ...e, outcome: outcomes.get(e.id) })),
      learner_messages: turns.filter((t) => t.speaker === 'learner').map((t) => t.text),
      // Ready-made citations (live coach_v2 runs cited unclear or missed evidence as strengths,
      // and gave improvements no evidence at all).
      praise_evidence_ids: candidate.evidence.filter((e) => outcomes.get(e.id) === 'met').map((e) => e.id),
      gaps_by_skill: Object.fromEntries(bundle.rubric.dimensions.map((d) => [d.id, candidate.evidence.filter((e) => e.check_id && d.check_ids.includes(e.check_id) && ['missed', 'violated', 'unclear'].includes(outcomes.get(e.id)!)).map((e) => e.id)])),
      rules: [
        'Each evidence item has an outcome decided by the platform: met, missed, violated, unclear or other. Use it as given.',
        'Strengths and the best moment may cite only evidence whose outcome is met (see praise_evidence_ids).',
        'Every improvement must cite at least one evidence id from gaps_by_skill for the skill it is about.',
        'Missed questions, improvements and the missed opportunity may cite only evidence whose outcome is missed or violated (improvements may also cite unclear).',
        'Never say the learner did not ask something that appears in learner_messages, and do not credit behaviour the evidence does not show.',
        ...(L.feedback_instruction ? [L.feedback_instruction] : []),
        `List at most ${MAX_MISSED_QUESTIONS} missed questions, the most important first (priority: ${(runtimeOf(bundle).evaluation_guide?.framework.map((a) => a.area) ?? []).join(' > ') || 'rubric order'}). Missed questions cite only coverage (discovery question) checks; conversation skills go under improvements.`,
      ],
      checks: bundle.rubric.checks.map((c) => ({ id: c.id, description: c.description, category: c.category, suggested_question: exampleFor(c.accepted_intents), absence: c.id in rt.absence_checks })),
      risk_flags: candidate.risk_flags.filter((f) => f.status === 'confirmed').map((f) => ({ rule_id: f.rule_id, description: bundle.risk_policy.rules.find((r) => r.id === f.rule_id)?.description ?? f.rule_id, evidence_ids: f.evidence_ids })),
    },
    retry_options_json: retryOptions,
  };
}

export function validateCoaching(raw: string, evidence: Evidence[], turns: TranscriptTurn[], outcomes?: Map<string, Outcome>, coverageEvidenceIds?: Set<string>): { ok: true; candidate: CoachingCandidate; notes: string[] } | { ok: false; errors: string[]; notes: string[] } {
  const notes: string[] = [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, errors: ['Output is not valid JSON.'], notes }; }
  // Lists come in priority order; items past a list's cap (a 4th improvement or 7th strength
  // in live Hindi runs, 29 Sep 2026) are dropped rather than failing the whole report.
  // Everything kept is still validated below. Caps come from the report contract.
  const p = parsed as Record<string, unknown>;
  for (const [k, max] of Object.entries(LIST_CAPS)) if (Array.isArray(p?.[k]) && (p[k] as unknown[]).length > max) p[k] = (p[k] as unknown[]).slice(0, max);
  if (!checkShape(parsed)) return { ok: false, errors: (checkShape.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`), notes };
  const c = parsed as unknown as CoachingCandidate;
  if (outcomes) dropUncitableFindings(c, outcomes, notes);
  const ids = new Set(evidence.map((e) => e.id));
  const learnerText = turns.filter((t) => t.speaker === 'learner').map((t) => t.text).join('\n');
  const errors: string[] = [];
  const all: [string, Finding][] = [
    ...c.strengths.map((f, i) => [`strengths[${i}]`, f] as [string, Finding]),
    ...c.improvement_areas.map((f, i) => [`improvement_areas[${i}]`, f] as [string, Finding]),
    ...c.missed_questions.map((f, i) => [`missed_questions[${i}]`, f] as [string, Finding]),
    ...c.risky_statements.map((f, i) => [`risky_statements[${i}]`, f] as [string, Finding]),
    ...(c.best_moment ? [['best_moment', c.best_moment] as [string, Finding]] : []),
    ...(c.missed_opportunity ? [['missed_opportunity', c.missed_opportunity] as [string, Finding]] : []),
  ];
  for (const [w, f] of all) {
    if (!f.evidence_ids.length) errors.push(`${w}: every finding must cite verified evidence.`);
    for (const id of f.evidence_ids) if (!ids.has(id)) errors.push(`${w}: cites unknown evidence "${id}".`);
    // Anything presented as the learner's words must be their words.
    for (const m of f.text.matchAll(/“([^”]+)”/g)) if (m[1] && !learnerText.includes(m[1])) errors.push(`${w}: quotes words the learner did not say.`);
  }
  if (outcomes) {
    // Praise needs a met result; a gap needs a missed or violated one.
    const allowed: [string, Finding[], Outcome[]][] = [
      ['strengths', c.strengths, ['met']],
      ['best_moment', c.best_moment ? [c.best_moment] : [], ['met']],
      ['missed_questions', c.missed_questions, ['missed', 'violated']],
      ['missed_opportunity', c.missed_opportunity ? [c.missed_opportunity] : [], ['missed', 'violated']],
      ['improvement_areas', c.improvement_areas, ['missed', 'violated', 'unclear']],
    ];
    for (const [w, fs, ok] of allowed) fs.forEach((f, i) => {
      const bad = f.evidence_ids.filter((id) => ids.has(id) && !ok.includes(outcomes.get(id)!));
      if (bad.length) errors.push(`${w}[${i}]: cites ${bad.map((id) => `"${id}" (${outcomes.get(id)})`).join(', ')}; allowed outcomes here: ${ok.join(', ')}.`);
    });
  }
  // "Missed questions" are discovery questions; conversation skills belong under improvements.
  if (coverageEvidenceIds) c.missed_questions.forEach((f, i) => {
    const other = f.evidence_ids.filter((id) => ids.has(id) && !coverageEvidenceIds.has(id));
    if (other.length) errors.push(`missed_questions[${i}]: cites ${other.map((id) => `"${id}"`).join(', ')}, which is not a discovery question; put conversation skills under improvement_areas.`);
  });
  return errors.length ? { ok: false, errors, notes } : { ok: true, candidate: c, notes };
}

/**
 * A citation whose outcome does not fit the finding (praise citing a gap, a gap citing a met
 * result) is removed, and a finding left with no valid citation is dropped, so one misjudged
 * line cannot cost the learner the whole written report. Everything kept still cites evidence.
 */
function dropUncitableFindings(c: CoachingCandidate, outcomes: Map<string, Outcome>, notes: string[]) {
  const allowed: Record<string, Outcome[]> = {
    strengths: ['met'], missed_questions: ['missed', 'violated'], improvement_areas: ['missed', 'violated', 'unclear'],
  };
  for (const [key, ok] of Object.entries(allowed) as [keyof CoachingCandidate, Outcome[]][]) {
    const list = c[key] as Finding[];
    const kept = list.map((f) => ({ ...f, evidence_ids: f.evidence_ids.filter((id) => !outcomes.has(id) || ok.includes(outcomes.get(id)!)) }))
      .filter((f, i) => { const keep = f.evidence_ids.length > 0; if (!keep) notes.push(`${key}[${i}] dropped: no citation with an allowed outcome.`); return keep; });
    if (kept.some((f, i) => f.evidence_ids.length !== list[i]?.evidence_ids.length)) notes.push(`${key}: citations with the wrong outcome removed.`);
    (c as unknown as Record<string, Finding[]>)[key] = kept;
  }
  for (const key of ['best_moment', 'missed_opportunity'] as const) {
    const f = c[key]; const ok = key === 'best_moment' ? ['met'] : ['missed', 'violated'];
    if (f && !f.evidence_ids.some((id) => !outcomes.has(id) || ok.includes(outcomes.get(id)!))) { c[key] = null; notes.push(`${key} dropped: no citation with an allowed outcome.`); }
  }
}

/**
 * Where a focused retry should resume: just before the earliest learner turn
 * that touched a practice target or made a risky statement, so the retry
 * starts before those opportunities (spec §20). With neither, after the first
 * third of the learner's turns. The opening is the earliest possible checkpoint.
 */
export function focusedCheckpoint(turns: TranscriptTurn[], cutBeforeTurnIds: string[]): TranscriptTurn {
  const learner = turns.filter((t) => t.speaker === 'learner');
  const first = turns.find((t) => cutBeforeTurnIds.includes(t.id));
  let cut: TranscriptTurn | undefined;
  if (first) cut = [...turns].reverse().find((t) => t.sequence < first.sequence && t.speaker === 'customer');
  else {
    const k = Math.ceil(learner.length / 3);
    const pivot = learner[k - 1];
    cut = pivot ? turns.find((t) => t.sequence === pivot.sequence + 1 && t.speaker === 'customer') : undefined;
  }
  return cut ?? turns[0];
}
