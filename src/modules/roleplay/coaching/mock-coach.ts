import type { CoachingCandidate, Evidence, Finding } from '../contracts/types';

/**
 * Deterministic stand-in for the coach model. Template sentences built only
 * from the verified assessment; every finding cites the evidence it rests on.
 */

export interface CoachInput {
  assessment_json: {
    dimensions: { id: string; name: string; score: number; max: number; rationale: string; anchor: string; evidence_ids: string[] }[];
    evidence: (Evidence & { outcome?: string })[];
    learner_messages?: string[];
    rules?: string[];
    checks: { id: string; description: string; category: string; suggested_question: string | null; absence: boolean }[];
    risk_flags: { rule_id: string; description: string; evidence_ids: string[] }[];
    mode: 'full' | 'focused';
    target_check_ids: string[];
  };
  retry_options_json: unknown;
}

export function mockCoach(input: CoachInput): CoachingCandidate {
  const a = input.assessment_json;
  const ev = new Map(a.evidence.map((e) => [e.id, e]));
  const checks = new Map(a.checks.map((c) => [c.id, c]));
  const quote = (id: string) => ev.get(id)?.learner_spans[0]?.quote;
  const inScope = (checkId?: string) => a.mode === 'full' || (!!checkId && a.target_check_ids.includes(checkId));

  const observedAsks = a.evidence.filter((e) => e.status === 'observed' && e.check_id && checks.get(e.check_id)?.category === 'coverage' && inScope(e.check_id));
  const strengths: Finding[] = [];
  for (const d of [...a.dimensions].sort((x, y) => y.score / y.max - x.score / x.max)) {
    if (a.mode === 'focused' || d.score < d.max - 1) break;
    const cite = d.evidence_ids.filter((id) => ev.get(id)?.status === 'observed' && ev.get(id)?.learner_spans.length);
    if (!cite.length) continue;
    strengths.push({ text: `${d.name}: ${d.score}/${d.max}. ${d.anchor}`, evidence_ids: cite.slice(0, 3), suggested_question: null });
    if (strengths.length === 3) break;
  }
  if (!strengths.length && observedAsks.length) {
    strengths.push({ text: `You asked: “${quote(observedAsks[0].id)}”`, evidence_ids: [observedAsks[0].id], suggested_question: null });
  }

  const missed = a.evidence.filter((e) => e.status === 'not_observed' && e.check_id && !checks.get(e.check_id)?.absence && inScope(e.check_id));
  const missed_questions: Finding[] = missed
    .filter((e) => checks.get(e.check_id!)?.category === 'coverage')
    .map((e) => ({ text: `Not asked: ${checks.get(e.check_id!)!.description.replace(/^./, (c) => c.toLowerCase())}.`, evidence_ids: [e.id], suggested_question: checks.get(e.check_id!)!.suggested_question }));

  const improvement_areas: Finding[] = [];
  if (a.mode === 'full') {
    for (const d of [...a.dimensions].sort((x, y) => x.score / x.max - y.score / y.max)) {
      if (d.score >= d.max || improvement_areas.length === 3) continue;
      const gap = missed.find((e) => d.evidence_ids.includes(e.id)) ?? a.evidence.find((e) => d.evidence_ids.includes(e.id) && e.status === 'contradicted');
      if (!gap) continue;
      const c = gap.check_id ? checks.get(gap.check_id) : undefined;
      improvement_areas.push({ text: `${d.name} (${d.score}/${d.max}): ${d.rationale}`, evidence_ids: [gap.id], suggested_question: c?.suggested_question ?? null });
    }
  } else {
    improvement_areas.push(...missed_questions.slice(0, 3));
  }

  const risky_statements: Finding[] = a.risk_flags.map((f) => ({
    text: `${f.description}: “${quote(f.evidence_ids[0]) ?? ''}”`, evidence_ids: f.evidence_ids, suggested_question: null,
  }));

  const best = observedAsks.sort((x, y) => y.confidence - x.confidence)[0];
  // The missed opportunity comes from the weakest dimension that has an unasked question.
  const weakest = [...a.dimensions].sort((x, y) => x.score / x.max - y.score / y.max);
  const opportunity = weakest.map((d) => missed_questions.find((f) => d.evidence_ids.includes(f.evidence_ids[0]))).find(Boolean) ?? missed_questions[0] ?? null;
  return {
    strengths, improvement_areas, missed_questions, risky_statements,
    best_moment: best ? { text: `A strong discovery question: “${quote(best.id)}”`, evidence_ids: [best.id], suggested_question: null } : null,
    missed_opportunity: opportunity ? { ...opportunity, text: `You could have asked about ${checks.get(ev.get(opportunity.evidence_ids[0])!.check_id!)!.description.replace(/^(asks|checks|explores)\s+(about\s+)?/i, '').toLowerCase()}.` } : null,
  };
}
