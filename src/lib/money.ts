/**
 * Every monetary value in this system is an integer number of paise.
 *
 * Rupee floats are banned: a ₹18,000 salary that becomes 180 in a downstream
 * calculation is the classic seed-data bug, and mixing units in one codebase
 * is how it happens. Convert only at the display boundary.
 */
export type Paise = number;

export const rupees = (r: number): Paise => Math.round(r * 100);
export const toRupees = (p: Paise): number => p / 100;

export function formatINR(p: Paise, opts: { decimals?: boolean } = {}): string {
  const value = toRupees(p);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(value);
}

/** Compact monthly-pay display used across job cards. */
export function formatPay(fixed: Paise, variableMax: Paise): string {
  if (variableMax > 0) {
    return `${formatINR(fixed)} fixed + up to ${formatINR(variableMax)} variable`;
  }
  return `${formatINR(fixed)} fixed`;
}

/**
 * s.194H TDS on commission. 2% once cumulative payments to a partner cross
 * ₹20,000 in a financial year; 20% if the partner has no PAN.
 * Basis points so the rate itself is never a float.
 */
export const TDS_THRESHOLD_PAISE = rupees(20_000);
export const TDS_RATE_BP_WITH_PAN = 200;    // 2.00%
export const TDS_RATE_BP_NO_PAN = 2000;     // 20.00%

export function tdsRateBp(hasPan: boolean, fyCumulativePaise: Paise): number {
  if (fyCumulativePaise <= TDS_THRESHOLD_PAISE) return 0;
  return hasPan ? TDS_RATE_BP_WITH_PAN : TDS_RATE_BP_NO_PAN;
}

export function applyTds(gross: Paise, rateBp: number): { tds: Paise; net: Paise } {
  const tds = Math.round((gross * rateBp) / 10_000);
  return { tds, net: gross - tds };
}
