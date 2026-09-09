/**
 * Human-readable, prefixed identifiers.
 *
 * The canonical seed uses fixed IDs (CAN-001, JOB-001, UNL-001) so that a demo
 * reset reproduces exactly the outcomes described in §22 — that is a §25
 * acceptance criterion. Runtime IDs continue the same series.
 */
import { sql } from './db';

const TABLE_FOR_PREFIX: Record<string, string> = {
  EMP: 'app.employer_organisation',
  LOC: 'app.employer_location',
  EU: 'app.employer_user',
  PAR: 'app.partner',
  SITE: 'app.partner_site',
  JOB: 'app.job',
  CAN: 'app.candidate',
  ALR: 'app.job_alert',
  PJA: 'app.partner_job_alert',
  JC: 'app.job_change',
  DR: 'app.data_request',
  DOC: 'app.candidate_document',
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

/**
 * Next sequential ID for a prefix, e.g. nextId('CAN') -> 'CAN-009'.
 *
 * Pass the transaction handle when calling this inside `sql.begin`. The pool is
 * deliberately tiny on serverless, so a call that reaches for the global `sql`
 * while a transaction holds a connection waits for a connection the transaction
 * will never release — a hang with no error, which is the worst kind.
 */
export async function nextId(prefix: string, conn = sql): Promise<string> {
  const table = TABLE_FOR_PREFIX[prefix];
  if (!table) throw new Error(`Unknown id prefix: ${prefix}`);
  // Only rows whose suffix is purely numeric participate in the series, so a
  // structured seed id such as CRD-JOB001-0 cannot break the sequence.
  const [row] = await conn<{ n: number }[]>`
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
