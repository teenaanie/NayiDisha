/** "72/100 · Effective" for weighted scoring; the raw sum ("22/30 · Good") otherwise. */
export function scoreHeadline(score: { mode?: string; final_percent?: number | string | null; raw_total?: number | string | null; raw_max?: number | string | null; band_label?: string | null }) {
  return score.mode === 'weighted_percent' ? `${Number(score.final_percent)}/100 · ${score.band_label}` : `${score.raw_total}/${score.raw_max} · ${score.band_label}`;
}
