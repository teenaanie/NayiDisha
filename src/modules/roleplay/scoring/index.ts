import type { Rubric, ScoringPolicy, ScoreResult } from '../contracts/types';

/**
 * Deterministic scoring (spec §12).
 *
 * Pure functions over validated dimension scores. Arithmetic is exact: scores
 * and weights become BigInt fractions, band membership is decided on the exact
 * value, and only the displayed number is rounded. A replay of a stored
 * assessment therefore reproduces the result bit for bit (FR12, AT26).
 */

export class ScoringError extends Error {}

// ---- exact rationals --------------------------------------------------------

export interface Q { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
export const q = (n: bigint, d = 1n): Q => { if (d === 0n) throw new ScoringError('Division by zero.'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
/** From a JS number via its shortest decimal form, so 0.1 is exactly 1/10. */
export function qFrom(x: number): Q {
  if (!Number.isFinite(x)) throw new ScoringError(`Not a finite number: ${x}`);
  const s = x.toString();
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(s);
  if (!m) throw new ScoringError(`Cannot read number ${s}`);
  const [, sign, int, frac = '', exp = '0'] = m;
  let n = BigInt(sign + int + frac); let d = 10n ** BigInt(frac.length);
  const e = Number(exp);
  if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
  return q(n, d);
}
export const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const cmp = (a: Q, b: Q) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
export const qMin = (a: Q, b: Q) => (cmp(a, b) <= 0 ? a : b);
export const qMax = (a: Q, b: Q) => (cmp(a, b) >= 0 ? a : b);
export const qStr = (a: Q) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
export function qParse(s: string): Q { const [n, d = '1'] = s.split('/'); return q(BigInt(n), BigInt(d)); }

/** Round half away from zero to `places` decimals, for display only. */
export function qRound(a: Q, places: number): number {
  const scale = 10n ** BigInt(places);
  const scaled = a.n * scale * 2n;
  const den = a.d * 2n;
  let r = scaled / den; const rem = scaled % den;
  if ((rem < 0n ? -rem : rem) * 2n >= den) r += a.n < 0n ? -1n : 1n;
  return Number(r) / Number(scale);
}

// ---- scoring ----------------------------------------------------------------

export interface ScoreInput {
  dimension_id: string;
  score: number | null;
  /** Only a conditional dimension may be excluded, and only with a reason. */
  not_applicable_reason?: string;
}
export interface ScoreOptions {
  /** Risk rule IDs confirmed in this assessment; duplicates count once. */
  confirmedRiskRuleIds?: string[];
  reviewRequired?: boolean;
}

export function scoreAssessment(rubric: Rubric, policy: ScoringPolicy, inputs: ScoreInput[], opts: ScoreOptions = {}): ScoreResult {
  const byId = new Map<string, ScoreInput>();
  for (const i of inputs) {
    if (!rubric.dimensions.some((d) => d.id === i.dimension_id)) throw new ScoringError(`Unknown dimension "${i.dimension_id}".`);
    if (byId.has(i.dimension_id)) throw new ScoringError(`Dimension "${i.dimension_id}" scored twice.`);
    byId.set(i.dimension_id, i);
  }
  const excluded: { dimension_id: string; reason: string }[] = [];
  const scored: { id: string; s: number; min: number; max: number }[] = [];
  for (const d of rubric.dimensions) {
    const i = byId.get(d.id);
    if (!i) throw new ScoringError(`Dimension "${d.id}" is missing; incomplete sets are never imputed.`);
    if (i.not_applicable_reason) {
      if (d.applicability !== 'conditional') throw new ScoringError(`Required dimension "${d.id}" cannot be excluded.`);
      excluded.push({ dimension_id: d.id, reason: i.not_applicable_reason });
      continue;
    }
    if (i.score === null || !Number.isInteger(i.score)) throw new ScoringError(`Dimension "${d.id}" needs an integer score.`);
    if (i.score < d.min_score || i.score > d.max_score) throw new ScoringError(`Score ${i.score} for "${d.id}" is outside ${d.min_score}–${d.max_score}.`);
    scored.push({ id: d.id, s: i.score, min: d.min_score, max: d.max_score });
  }
  if (!scored.length) throw new ScoringError('No applicable dimensions; the assessment is unscorable.');

  const rawTotal = scored.reduce((a, x) => a + x.s, 0);
  const rawMax = scored.reduce((a, x) => a + x.max, 0);
  let base: Q;
  if (policy.mode === 'unweighted_sum') {
    base = q(100n * BigInt(rawTotal), BigInt(rawMax));
  } else {
    let num = q(0n); let den = q(0n);
    for (const x of scored) {
      const w = qFrom(policy.weights[x.id] ?? NaN);
      if (w.n < 0n) throw new ScoringError(`Negative weight for "${x.id}".`);
      num = add(num, mul(w, q(BigInt(x.s), BigInt(x.max))));
      den = add(den, w);
    }
    if (den.n === 0n) throw new ScoringError('Applicable weights sum to zero.');
    base = mul(q(100n), div(num, den));
  }

  // Configured risk consequence: one operation, applied once however many flags repeat.
  const confirmed = Array.from(new Set(opts.confirmedRiskRuleIds ?? []));
  const params = policy.risk_effect_parameters as { rule_ids?: string[]; max_percent?: number; percent_points?: number; outcome_label?: string };
  const triggered = confirmed.filter((id) => (params.rule_ids ?? []).includes(id));
  const adjustments: ScoreResult['adjustments'] = [];
  let final = base;
  let gate: ScoreResult['gate'];
  if (triggered.length && policy.risk_effect === 'cap') {
    const capped = qMin(base, qFrom(params.max_percent!));
    adjustments.push({ type: 'cap', detail: `Capped at ${params.max_percent}% for ${triggered.join(', ')}`, before: qRound(base, policy.display_decimals), after: qRound(capped, policy.display_decimals) });
    final = capped;
  } else if (triggered.length && policy.risk_effect === 'deduction') {
    const reduced = qMax(q(0n), sub(base, qFrom(params.percent_points!)));
    adjustments.push({ type: 'deduction', detail: `${params.percent_points} points deducted for ${triggered.join(', ')}`, before: qRound(base, policy.display_decimals), after: qRound(reduced, policy.display_decimals) });
    final = reduced;
  } else if (triggered.length && policy.risk_effect === 'gate') {
    gate = { rule_ids: triggered, outcome: params.outcome_label! };
  }
  final = qMin(qMax(final, q(0n)), q(100n));

  // Bands are decided on the exact value: raw bands on the raw scale, percent bands on percent.
  const bandValue = policy.band_scale === 'raw_sum'
    ? (adjustments.length ? mul(final, q(BigInt(rawMax), 100n)) : q(BigInt(rawTotal)))
    : final;
  const band = policy.bands.find((b) => cmp(bandValue, qFrom(b.lower)) >= 0 && (cmp(bandValue, qFrom(b.upper)) < 0 || (b.upper_inclusive && cmp(bandValue, qFrom(b.upper)) === 0)));
  if (!band) throw new ScoringError(`No band covers ${qStr(bandValue)}; the policy failed validation.`);

  return {
    mode: policy.mode,
    raw_total: rawTotal,
    raw_max: rawMax,
    base_percent: qRound(base, policy.display_decimals),
    final_percent: qRound(final, policy.display_decimals),
    band_id: band.id,
    band_label: band.label,
    adjustments,
    outcome: opts.reviewRequired ? 'review_required' : 'complete',
    exact: { base_percent: qStr(base), final_percent: qStr(final) },
    excluded_dimensions: excluded,
    ...(gate ? { gate } : {}),
  };
}
