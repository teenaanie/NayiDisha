/**
 * Human-readable, prefixed identifiers.
 *
 * The canonical seed uses fixed IDs (CAN-001, JOB-001, UNL-001) so that a demo
 * reset reproduces exactly the outcomes described in §22 — that is a §25
 * acceptance criterion. Runtime IDs continue the same series.
 */
import { sql } from './db';

const TABLE_FOR_PREFIX: Record<string, string> = {
  CAN: 'app.candidate',
  APP: 'app.application',
  MATCH: 'app.match_result',
  UNL: 'app.qualified_lead_unlock',
  RWD: 'app.reward_ledger',
  CRD: 'app.credit_ledger',
  RPL: 'app.replacement_case',
  PAY: 'app.payout',
  END: 'app.endorsement',
  ATT: 'app.attribution',
  ATV: 'app.candidate_attribute_value',
  CNS: 'app.consent_record',
  ASM: 'app.assessment_attempt',
  MSG: 'app.message_log',
  AUD: 'app.audit_log',
  FRD: 'app.fraud_case',
  OUT: 'app.optional_outcome_event',
  NDG: 'app.partner_nudge',
  ITV: 'app.interview',
  ONB: 'app.onboarding_case',
  ENT: 'app.posting_entitlement',
  ACH: 'app.achievement',
};

/** Next sequential ID for a prefix, e.g. nextId('CAN') -> 'CAN-009'. */
export async function nextId(prefix: string): Promise<string> {
  const table = TABLE_FOR_PREFIX[prefix];
  if (!table) throw new Error(`Unknown id prefix: ${prefix}`);
  // Only rows whose suffix is purely numeric participate in the series, so a
  // structured seed id such as CRD-JOB001-0 cannot break the sequence.
  const [row] = await sql<{ n: number }[]>`
    SELECT COALESCE(MAX(substring(id from '^[A-Z]+-([0-9]+)$')::int), 0) + 1 AS n
    FROM ${sql.unsafe(table)}
    WHERE id ~ ${'^' + prefix + '-[0-9]+$'}
  `;
  return `${prefix}-${String(row.n).padStart(3, '0')}`;
}

/** Deterministic idempotency key for an unlock (LEAD-05/07). */
export function unlockIdempotencyKey(
  employerId: string, jobId: string, candidateId: string,
): string {
  return `unlock:${employerId}:${jobId}:${candidateId}`;
}

export function randomToken(len = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
