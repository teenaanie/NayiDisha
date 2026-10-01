import Ajv from 'ajv';
import type { EvaluationCandidate, ScenarioBundle, TranscriptTurn, Span } from '../contracts/types';
import { evaluationCandidateSchema } from '../contracts/schemas';
import { cpLength, cpSlice, codePoints, sentences, isQuestion } from '../runtime/text';
import { runtimeOf } from '../config/runtime-extension';

/**
 * Evaluation candidate validation (spec §14).
 *
 * Parsing is not acceptance. A candidate is accepted only when its schema,
 * pinned identifiers, dimension set, score bounds, evidence references,
 * speaker attribution and every quotation check out against the frozen
 * transcript. Quotes must match the committed text exactly; a paraphrased or
 * invented quote rejects the candidate.
 *
 * Mechanical slips are normalised before validation, and each is recorded
 * (live runs, 29–30 Sep 2026, failed on exactly these):
 *  - a question-credit quote that does not read as a question is dropped (the
 *    item keeps its other quotes, or becomes `uncertain` with none left);
 *  - a confidence just above 1 (1.1) is capped at 1;
 *  - a non-absence check `observed` with no learner quote becomes `uncertain`
 *    (no credit) instead of rejecting the whole assessment;
 *  - a verbatim quote at wrong offsets (or offsets longer than the quote) is
 *    moved to where it occurs in the same turn (models count characters badly,
 *    e.g. "₹" as two; the words are what matter);
 *  - an absence check ("avoids guarantees") reported as `observed` with no
 *    learner span is recorded as `not_observed` over every assessable turn, the
 *    platform's convention for "the violation was not seen", or as `uncertain`
 *    when the check requires discovery and none happened (a one-question attempt
 *    has not "avoided a guarantee"). A claimed violation still needs a quote
 *    (`contradicted` + span).
 */

export const VALIDATOR_VERSION = 'evaluation-validator-1.7.0';

/** Relocate a quote to its occurrence in the turn nearest the stated start; null if absent. */
function relocate(text: string, quote: string, start: number): { start: number; end: number } | null {
  if (!quote) return null;
  const cps = codePoints(text); const q = codePoints(quote);
  let best: number | null = null;
  for (let i = 0; i + q.length <= cps.length; i++) {
    let ok = true;
    for (let j = 0; j < q.length && ok; j++) ok = cps[i + j] === q[j];
    if (ok && (best === null || Math.abs(i - start) < Math.abs(best - start))) best = i;
  }
  return best === null ? null : { start: best, end: best + q.length };
}

export function normalizeCandidate(c: EvaluationCandidate, ctx: ValidationContext): string[] {
  const notes: string[] = [];
  const turns = new Map(ctx.turns.map((t) => [t.id, t]));
  const fix = (sp: Span, where: string) => {
    const t = turns.get(sp.turn_id);
    // Exact fit only: text at the offsets equals the quote AND the offsets span exactly the quote
    // (live, 29 Sep 2026: a correct quote with end 68 in a 67-code-point turn, "₹" counted twice).
    if (!t || (cpSlice(t.text, sp.start, sp.end) === sp.quote && sp.end - sp.start === cpLength(sp.quote))) return;
    const at = relocate(t.text, sp.quote, sp.start);
    if (at) { notes.push(`${where}: quote moved ${sp.start}–${sp.end} → ${at.start}–${at.end}.`); sp.start = at.start; sp.end = at.end; }
  };
  for (const [i, ev] of c.evidence.entries()) {
    // A claimed observation with no learner quote cannot earn credit; record it as uncertain
    // rather than failing the whole assessment (absence checks are handled below).
    if (ev.status === 'observed' && !ev.learner_spans.length && !(ev.check_id && ev.check_id in runtimeOf(ctx.bundle).absence_checks)) {
      ev.status = 'uncertain';
      notes.push(`evidence[${i}] ${ev.id}: observed without a learner quote; recorded as uncertain (no credit).`);
    }
  }
  const absence = runtimeOf(ctx.bundle).absence_checks;
  const category = new Map(ctx.bundle.rubric.checks.map((x) => [x.id, x.category]));
  // "Avoided a guarantee" means little in a conversation with no discovery (spec'd by requires_discovery).
  const anyDiscovery = c.evidence.some((x) => x.status === 'observed' && x.check_id && category.get(x.check_id) === 'coverage' && x.learner_spans.length > 0);
  for (const [i, ev] of c.evidence.entries()) {
    ev.learner_spans.forEach((sp, j) => fix(sp, `evidence[${i}] ${ev.id} learner_spans[${j}]`));
    ev.context_spans.forEach((sp, j) => fix(sp, `evidence[${i}] ${ev.id} context_spans[${j}]`));
    if (ev.check_id && ev.check_id in absence && (ev.status === 'not_observed' || (ev.status === 'observed' && ev.learner_spans.length > 0)) && absence[ev.check_id].requires_discovery && !anyDiscovery) {
      ev.status = 'uncertain';
      notes.push(`evidence[${i}] ${ev.id}: absence check passed with no discovery yet to judge it against; recorded as uncertain.`);
    } else if (ev.check_id && ev.check_id in absence && ev.status === 'observed' && !ev.learner_spans.length) {
      const early = absence[ev.check_id].requires_discovery && !anyDiscovery;
      ev.status = early ? 'uncertain' : 'not_observed';
      ev.searched_turn_ids = [...ctx.assessable_learner_turn_ids];
      notes.push(`evidence[${i}] ${ev.id}: absence check reported as observed without a quote; recorded as ${ev.status}${early ? ' (no discovery yet to judge it against)' : ''}.`);
    }
  }
  // "Not observed" asserts a search of every assessable learner turn; the list is
  // bookkeeping the server can complete (a Hindi run left 12 turns out and was rejected).
  for (const [i, ev] of c.evidence.entries()) {
    if (ev.status !== 'not_observed') continue;
    const missing = ctx.assessable_learner_turn_ids.filter((id) => !(ev.searched_turn_ids ?? []).includes(id));
    if (!missing.length) continue;
    ev.searched_turn_ids = [...new Set([...(ev.searched_turn_ids ?? []), ...missing])];
    notes.push(`evidence[${i}] ${ev.id}: search list completed with ${missing.length} assessable turn(s).`);
  }
  // Question credit needs a quote that asks. A quote that does not read as a question
  // (live Hindi run, 30 Sep 2026: a spoken yes/no question transcribed with "।" and no
  // question word) is dropped rather than failing the whole assessment; with no asking
  // quote left, the item earns no credit.
  const checkDefs = new Map(ctx.bundle.rubric.checks.map((x) => [x.id, x]));
  const turnById = new Map(ctx.turns.map((t) => [t.id, t]));
  for (const [i, ev] of c.evidence.entries()) {
    if (ev.status !== 'observed' || !ev.check_id || checkDefs.get(ev.check_id)?.credit_requires !== 'learner_question') continue;
    const asks = ev.learner_spans.filter((sp) => {
      const t = turnById.get(sp.turn_id);
      // Only verified learner quotes are judged here; a customer turn cited as learner evidence stays and is rejected below.
      // A quote that does not match its turn is not ours to drop either: validation rejects it.
      if (!t || t.speaker !== 'learner' || cpSlice(t.text, sp.start, sp.end) !== sp.quote) return true;
      return sentences(t.text).some((x) => x.start <= sp.start && sp.end <= x.end && isQuestion(x.text));
    });
    if (asks.length === ev.learner_spans.length) continue;
    notes.push(`evidence[${i}] ${ev.id}: ${ev.learner_spans.length - asks.length} quote(s) that do not read as a question dropped${asks.length ? '' : '; no asking quote left, recorded as uncertain (no credit)'}.`);
    ev.learner_spans = asks;
    if (!asks.length) ev.status = 'uncertain';
  }
  return notes;
}
const ajv = new Ajv({ allErrors: true, strict: false });
const checkShape = ajv.compile(evaluationCandidateSchema);

export interface ValidationContext {
  bundle: ScenarioBundle;
  turns: TranscriptTurn[];
  session_id: string;
  transcript_hash: string;
  rubric_version: string;
  /** Learner turns that may carry credit; prefix turns of a focused retry are excluded. */
  assessable_learner_turn_ids: string[];
  /** 1.1 requires a coaching suggestion on every scored dimension. Default 1.0. */
  contract_version?: '1.0' | '1.1';
}

export function validateCandidate(raw: string, ctx: ValidationContext): { ok: true; candidate: EvaluationCandidate; notes: string[] } | { ok: false; errors: string[]; notes: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, errors: ['Output is not valid JSON.'], notes: [] }; }
  // Confidence is advisory (it only routes low-confidence findings to review); a value
  // above 1 (live: 1.1, and larger in a Hindi run) is capped rather than rejecting the
  // whole assessment. A category outside the rubric's list is only a label: recorded as
  // compliance, never a reason to fail.
  const preNotes: string[] = [];
  for (const [i, ev] of (((parsed as { evidence?: unknown[] })?.evidence ?? []) as { confidence?: unknown; id?: string }[]).entries()) {
    if (typeof ev?.confidence === 'number' && ev.confidence > 1) { preNotes.push(`evidence[${i}] ${ev.id}: confidence ${ev.confidence} capped at 1.`); ev.confidence = 1; }
  }
  // Risk evidence belongs to a risk rule, not a check; live runs (1 Oct 2026) sent check_id ""
  // or the risk rule's id there. Either is cleared rather than failing the assessment.
  const riskRuleIds = new Set(ctx.bundle.risk_policy.rules.map((r) => r.id));
  const checkIds = new Set(ctx.bundle.rubric.checks.map((c) => c.id));
  for (const [i, ev] of (((parsed as { evidence?: unknown[] })?.evidence ?? []) as { check_id?: unknown; id?: string }[]).entries()) {
    if (ev && 'check_id' in ev && (ev.check_id === '' || ev.check_id === null || (typeof ev.check_id === 'string' && riskRuleIds.has(ev.check_id) && !checkIds.has(ev.check_id)))) {
      preNotes.push(`evidence[${i}] ${ev.id}: check_id ${JSON.stringify(ev.check_id)} cleared (risk evidence has no check).`);
      delete ev.check_id;
    }
  }
  const knownCategories = new Set([...ctx.bundle.rubric.evidence_categories, 'compliance']);
  for (const [i, ev] of (((parsed as { evidence?: unknown[] })?.evidence ?? []) as { category?: unknown; id?: string }[]).entries()) {
    if (typeof ev?.category === 'string' && !knownCategories.has(ev.category)) { preNotes.push(`evidence[${i}] ${ev.id}: unknown category "${ev.category}" recorded as compliance.`); ev.category = 'compliance'; }
  }
  if (!checkShape(parsed)) return { ok: false, errors: (checkShape.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`), notes: preNotes };
  const c = parsed as unknown as EvaluationCandidate;
  const notes = [...preNotes, ...normalizeCandidate(c, ctx)];
  const errors: string[] = [];
  const e = (m: string) => errors.push(m);

  if (c.session_id !== ctx.session_id) e('session_id does not match the session under assessment.');
  if (c.contract_version !== (ctx.contract_version ?? '1.0')) e(`contract_version must be ${ctx.contract_version ?? '1.0'}.`);
  if (c.transcript_hash !== ctx.transcript_hash) e('transcript_hash does not match the frozen snapshot.');
  if (c.rubric_version !== ctx.rubric_version) e('rubric_version does not match the pinned rubric.');

  const turns = new Map(ctx.turns.map((t) => [t.id, t]));
  const assessable = new Set(ctx.assessable_learner_turn_ids);
  const checks = new Map(ctx.bundle.rubric.checks.map((x) => [x.id, x]));
  const categories = new Set([...ctx.bundle.rubric.evidence_categories, 'compliance']);

  const spanOk = (s: Span, where: string, learnerOnly: boolean) => {
    const t = turns.get(s.turn_id);
    if (!t) { e(`${where}: unknown turn ${s.turn_id}.`); return; }
    if (learnerOnly && t.speaker !== 'learner') e(`${where}: learner evidence cites a customer turn.`);
    if (learnerOnly && !assessable.has(t.id)) e(`${where}: cites a turn that is not assessable in this mode.`);
    const len = cpLength(t.text);
    if (!(s.start >= 0 && s.start < s.end && s.end <= len)) { e(`${where}: span ${s.start}–${s.end} is outside the turn (length ${len}).`); return; }
    if (cpSlice(t.text, s.start, s.end) !== s.quote) e(`${where}: quote does not match the transcript at ${s.start}–${s.end}.`);
  };

  const ids = new Set<string>();
  for (const [i, ev] of c.evidence.entries()) {
    const w = `evidence[${i}] ${ev.id}`;
    if (ids.has(ev.id)) e(`${w}: duplicate evidence id.`);
    ids.add(ev.id);
    if (!categories.has(ev.category)) e(`${w}: unknown category "${ev.category}".`);
    if (ev.check_id && !checks.has(ev.check_id)) e(`${w}: unknown check "${ev.check_id}".`);
    ev.learner_spans.forEach((s, j) => spanOk(s, `${w} learner_spans[${j}]`, true));
    ev.context_spans.forEach((s, j) => spanOk(s, `${w} context_spans[${j}]`, false));
    if ((ev.status === 'observed' || ev.status === 'contradicted') && !ev.learner_spans.length) e(`${w}: ${ev.status} needs at least one learner span.`);
    if (ev.status === 'not_observed') {
      if (ev.learner_spans.length) e(`${w}: not_observed cannot cite learner spans.`);
      const missing = ctx.assessable_learner_turn_ids.filter((id) => !ev.searched_turn_ids.includes(id));
      if (missing.length) e(`${w}: not_observed must record a search of every assessable learner turn (missing ${missing.length}).`);
    }
    // Question credit needs a question: a mention is not an ask (spec §11).
    const check = ev.check_id ? checks.get(ev.check_id) : undefined;
    if (check?.credit_requires === 'learner_question' && ev.status === 'observed') {
      for (const s of ev.learner_spans) {
        const t = turns.get(s.turn_id);
        if (!t) continue;
        const inQuestion = sentences(t.text).some((x) => x.start <= s.start && s.end <= x.end && isQuestion(x.text));
        if (!inQuestion) e(`${w}: question credit cites text that does not ask anything.`);
      }
    }
  }

  const dims = ctx.bundle.rubric.dimensions;
  const seen = new Set<string>();
  for (const [i, d] of c.dimension_scores.entries()) {
    const w = `dimension_scores[${i}] ${d.dimension_id}`;
    const def = dims.find((x) => x.id === d.dimension_id);
    if (!def) { e(`${w}: unknown dimension.`); continue; }
    if (seen.has(d.dimension_id)) e(`${w}: dimension scored twice.`);
    seen.add(d.dimension_id);
    if (d.score < def.min_score || d.score > def.max_score) e(`${w}: score ${d.score} outside ${def.min_score}–${def.max_score}.`);
    if (d.anchor_score !== d.score || !def.anchors.some((a) => a.score === d.anchor_score)) e(`${w}: anchor_score must be the defined anchor for the awarded score (got score ${d.score}, anchor_score ${d.anchor_score}; allowed ${def.anchors.map((a) => a.score).join(', ')}). Set both to the one anchor that fits.`);
    for (const id of d.evidence_ids) if (!ids.has(id)) e(`${w}: cites unknown evidence "${id}".`);
  }
  if ((ctx.contract_version ?? '1.0') === '1.1') {
    // Coaching may quote suggested wording, so its quotes are not checked against the transcript.
    for (const [i, d] of c.dimension_scores.entries()) if (!d.coaching?.trim()) e(`dimension_scores[${i}] ${d.dimension_id}: needs one coaching suggestion.`);
  }
  for (const d of dims) if (d.applicability === 'required' && !seen.has(d.id)) e(`Missing required dimension "${d.id}".`);

  const riskRules = new Set(ctx.bundle.risk_policy.rules.map((r) => r.id));
  const flagged = new Set<string>();
  for (const [i, f] of c.risk_flags.entries()) {
    const w = `risk_flags[${i}] ${f.rule_id}`;
    if (!riskRules.has(f.rule_id)) e(`${w}: unknown risk rule.`);
    if (flagged.has(f.rule_id)) e(`${w}: rule flagged twice.`);
    flagged.add(f.rule_id);
    if (!f.evidence_ids.length) e(`${w}: a flag needs evidence.`);
    for (const id of f.evidence_ids) {
      const ev = c.evidence.find((x) => x.id === id);
      if (!ev) e(`${w}: cites unknown evidence "${id}".`);
      else if (!ev.learner_spans.length) e(`${w}: evidence "${id}" has no learner span.`);
    }
  }

  return errors.length ? { ok: false, errors, notes } : { ok: true, candidate: c, notes };
}
