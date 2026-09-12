/**
 * Human-readable, prefixed identifiers.
 *
 * The canonical seed uses fixed IDs (CAN-001, JOB-001, UNL-001) so that a demo
 * reset reproduces exactly the outcomes described in §22 — that is a §25
 * acceptance criterion. Runtime IDs continue the same series.
 */
import { sql } from './db';
import { randomBytes } from 'node:crypto';

const TABLE_FOR_PREFIX: Record<string, string> = {
  REQ:'app.credit_request',ISS:'app.workflow_issue',
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

  // Once app.id_counter has a row for this prefix, bumping it is a single
  // indexed UPDATE. Only the very first call for a prefix needs the MAX(...)
  // scan below, to seed the counter correctly against whatever fixed-ID rows
  // the table already has (e.g. the canonical seed data).
  const [fast] = await conn<{ n: number }[]>`
    UPDATE app.id_counter SET value = value + 1 WHERE prefix = ${prefix} RETURNING value AS n
  `;
  if (fast) return `${prefix}-${String(fast.n).padStart(3, '0')}`;

  // Only rows whose suffix is purely numeric participate in the series, so a
  // structured seed id such as CRD-JOB001-0 cannot break the sequence.
  const [row] = await conn<{ n: number }[]>`
    INSERT INTO app.id_counter(prefix, value)
    SELECT ${prefix}, COALESCE(MAX(substring(id from '^[A-Z]+-([0-9]+)$')::bigint),0)+1
      FROM ${conn.unsafe(table)} WHERE id ~ ${'^'+prefix+'-[0-9]+$'}
    ON CONFLICT(prefix) DO UPDATE SET value=app.id_counter.value+1
    RETURNING value AS n
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
  return randomBytes(len).toString('base64url').slice(0, len);
}

/** Cryptographically-seeded Fisher-Yates shuffle — uniform, unlike a hash-mod comparator. */
export function shuffle<T>(items: T[]): T[] {
  const result = items.slice();
  const bytes = randomBytes(result.length);
  for (let i = result.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
