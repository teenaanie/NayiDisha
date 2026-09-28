import type { EvaluationCandidate, Evidence, Rubric, RiskPolicy, DimensionScoreCandidate } from '../contracts/types';
import type { RuntimeExtension } from '../config/runtime-extension';

/**
 * Deterministic stand-in for the evaluator model.
 *
 * It sees exactly the data a live evaluator is given and returns the same
 * EvaluationCandidate contract, so validation, reconciliation, scoring and
 * reporting are exercised end to end. Its judgement is mechanical:
 *
 *   * a check is satisfied when rule evidence observed it, or, for a configured
 *     absence check, when no linked violation was found in a conversation that
 *     contained discovery at all;
 *   * a confirmed risk on a dimension places it at the lowest anchor, which is
 *     what each source anchor 1 describes ("Promises approval", "Gives product
 *     pitch too early");
 *   * otherwise score = min + round((max − min) × satisfied/total), which lands
 *     on the recommended 2/4 rule: most-but-not-all satisfied gives 4.
 *
 * A live model is expected to do better on quality; the platform never trusts
 * either without validation.
 */

export interface JudgeInput {
  contract_json: { session_id: string; transcript_hash: string; rubric_version: string; previous_errors?: string[] };
  rubric_json: Rubric;
  risk_policy_json: RiskPolicy;
  checks_json: {
    rule_evidence: Evidence[];
    risk_candidates: { rule_id: string; evidence_id: string }[];
    assessable_learner_turn_ids: string[];
    unexplained_jargon: { term: string; turn_id: string }[];
    runtime: RuntimeExtension;
  };
}

export function mockJudge(input: JudgeInput): EvaluationCandidate {
  const rubric = input.rubric_json;
  const ce = input.checks_json;
  const evidence: Evidence[] = ce.rule_evidence.map((e) => ({ ...e }));
  const byCheck = new Map(evidence.filter((e) => e.check_id).map((e) => [e.check_id!, e]));
  const risks = new Map(input.risk_policy_json.rules.map((r) => [r.id, r]));
  const anyDiscovery = evidence.some((e) => e.category === 'coverage' && e.status === 'observed');

  // Absence checks: satisfied unless contradicted by a linked violation.
  for (const [checkId, spec] of Object.entries(ce.runtime.absence_checks)) {
    const violations = ce.risk_candidates.filter((c) => spec.risk_rule_ids?.includes(c.rule_id)).map((c) => evidence.find((e) => e.id === c.evidence_id)!);
    const jargon = spec.unexplained_jargon ? evidence.filter((e) => e.id.startsWith('jargon_')) : [];
    const against = [...violations, ...jargon];
    const id = `ev_${checkId}`.slice(0, 64);
    const existing = byCheck.get(checkId);
    const record: Evidence = against.length
      ? { id, category: 'compliance', check_id: checkId, status: 'contradicted', learner_spans: against.flatMap((e) => e.learner_spans).slice(0, 3), context_spans: [], searched_turn_ids: [], explanation: `Contradicted: ${against.length} linked statement(s) found.`, method: 'llm', confidence: 0.85 }
      : spec.requires_discovery && !anyDiscovery
        ? { id, category: 'compliance', check_id: checkId, status: 'uncertain', learner_spans: [], context_spans: [], searched_turn_ids: ce.assessable_learner_turn_ids, explanation: 'Too little conversation to judge.', method: 'llm', confidence: 0.5 }
        : { id, category: 'compliance', check_id: checkId, status: 'not_observed', learner_spans: [], context_spans: [], searched_turn_ids: ce.assessable_learner_turn_ids, explanation: 'No linked violation found in the assessable transcript.', method: 'llm', confidence: 0.8 };
    if (existing) Object.assign(existing, record); else { evidence.push(record); byCheck.set(checkId, record); }
  }

  const satisfied = (checkId: string) => {
    const e = byCheck.get(checkId);
    if (!e) return false;
    if (checkId in ce.runtime.absence_checks) return e.status === 'not_observed';
    return e.status === 'observed';
  };

  const dimension_scores: DimensionScoreCandidate[] = rubric.dimensions.map((d) => {
    const riskHere = ce.risk_candidates.filter((c) => risks.get(c.rule_id)?.dimension_ids.includes(d.id));
    const ids = [...d.check_ids.map((c) => byCheck.get(c)?.id).filter((x): x is string => !!x), ...riskHere.map((r) => r.evidence_id)];
    let score: number;
    let rationale: string;
    if (riskHere.length) {
      score = d.min_score;
      rationale = `Anchor ${score}: ${anchor(d, score)} Confirmed risk: ${[...new Set(riskHere.map((r) => r.rule_id))].join(', ')}.`;
    } else if (!anyDiscovery && d.check_ids.every((c) => !satisfied(c))) {
      score = d.min_score;
      rationale = `Anchor ${score}: ${anchor(d, score)} No relevant learner behaviour was observed.`;
    } else {
      const total = d.check_ids.length || 1;
      const met = d.check_ids.filter(satisfied).length;
      score = d.min_score + Math.round(((d.max_score - d.min_score) * met) / total);
      const missed = d.check_ids.filter((c) => !satisfied(c));
      rationale = `Anchor ${score}: ${anchor(d, score)} ${met} of ${total} supporting checks met${missed.length ? `; not met: ${missed.join(', ')}` : ''}.`;
    }
    return { dimension_id: d.id, score, anchor_score: score, evidence_ids: ids, rationale, status: 'scored' };
  });

  return {
    contract_version: '1.0',
    session_id: input.contract_json.session_id,
    transcript_hash: input.contract_json.transcript_hash,
    rubric_version: input.contract_json.rubric_version,
    evidence,
    dimension_scores,
    risk_flags: Object.values(ce.risk_candidates.reduce<Record<string, { rule_id: string; evidence_ids: string[]; status: 'confirmed' }>>((acc, c) => {
      (acc[c.rule_id] ??= { rule_id: c.rule_id, evidence_ids: [], status: 'confirmed' }).evidence_ids.push(c.evidence_id);
      return acc;
    }, {})),
  };
}

function anchor(d: Rubric['dimensions'][number], score: number) {
  return (d.anchors.find((a) => a.score === score)?.description ?? '').replace(/\.?$/, '.');
}
