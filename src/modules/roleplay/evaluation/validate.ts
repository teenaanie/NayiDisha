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
 * Two mechanical slips are normalised before validation, and each is recorded
 * (live runs, 29 Sep 2026, failed on exactly these):
 *  - a verbatim quote at wrong offsets is moved to where it occurs in the same
 *    turn (models count characters badly; the words are what matter);
 *  - an absence check ("avoids guarantees") reported as `observed` with no
 *    learner span is recorded as `not_observed` over every assessable turn, the
 *    platform's convention for "the violation was not seen". A claimed violation
 *    still needs a quote (`contradicted` + span).
 */

export const VALIDATOR_VERSION = 'evaluation-validator-1.1.0';

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
    if (!t || cpSlice(t.text, sp.start, sp.end) === sp.quote) return;
    const at = relocate(t.text, sp.quote, sp.start);
    if (at) { notes.push(`${where}: quote moved ${sp.start}–${sp.end} → ${at.start}–${at.end}.`); sp.start = at.start; sp.end = at.end; }
  };
  const absence = runtimeOf(ctx.bundle).absence_checks;
  for (const [i, ev] of c.evidence.entries()) {
    ev.learner_spans.forEach((sp, j) => fix(sp, `evidence[${i}] ${ev.id} learner_spans[${j}]`));
    ev.context_spans.forEach((sp, j) => fix(sp, `evidence[${i}] ${ev.id} context_spans[${j}]`));
    if (ev.check_id && ev.check_id in absence && ev.status === 'observed' && !ev.learner_spans.length) {
      ev.status = 'not_observed';
      ev.searched_turn_ids = [...ctx.assessable_learner_turn_ids];
      notes.push(`evidence[${i}] ${ev.id}: absence check reported as observed without a quote; recorded as not_observed.`);
    }
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
}

export function validateCandidate(raw: string, ctx: ValidationContext): { ok: true; candidate: EvaluationCandidate; notes: string[] } | { ok: false; errors: string[]; notes: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, errors: ['Output is not valid JSON.'], notes: [] }; }
  if (!checkShape(parsed)) return { ok: false, errors: (checkShape.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`), notes: [] };
  const c = parsed as unknown as EvaluationCandidate;
  const notes = normalizeCandidate(c, ctx);
  const errors: string[] = [];
  const e = (m: string) => errors.push(m);

  if (c.session_id !== ctx.session_id) e('session_id does not match the session under assessment.');
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
    if (d.anchor_score !== d.score || !def.anchors.some((a) => a.score === d.anchor_score)) e(`${w}: anchor_score must be the defined anchor for the awarded score.`);
    for (const id of d.evidence_ids) if (!ids.has(id)) e(`${w}: cites unknown evidence "${id}".`);
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
