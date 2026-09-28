import { sql } from '@/lib/db';
import { audit, requireRole, type Actor } from './context';

/**
 * Retention (spec §17, §23; AT25).
 *
 * Sessions older than the tenant's retention period are deleted with
 * everything derived from them: turns, analysis, disclosure ledger, snapshot,
 * evaluation runs and their evidence, scores, findings, reports, retry plans,
 * operations and analytics facts. Audit rows keep IDs and hashes only and are
 * governed by a separate policy (open decision).
 *
 * Backups: deleted rows persist in database backups until those expire.
 * Restoring an old backup brings them back; the purge must be re-run after any
 * restore before the database serves traffic (docs/roleplay/RUNBOOK.md).
 */
export async function purgeExpired(actor: Actor | null, tenantId: string, opts: { olderThanDays?: number; sessionIds?: string[] } = {}) {
  if (actor) requireRole(actor, 'tenant_admin');
  const [t] = await sql<{ retention_days: number }[]>`SELECT retention_days FROM rp.tenant WHERE id = ${tenantId}`;
  const days = opts.olderThanDays ?? t.retention_days;
  const ids = opts.sessionIds ?? (await sql<{ id: string }[]>`SELECT id FROM rp.session WHERE tenant_id = ${tenantId} AND started_at < now() - make_interval(days => ${days})`).map((r) => r.id);
  if (!ids.length) return { purged: 0 };
  await sql.begin(async (tx) => {
    // Children first; parent_session_id links are cleared so a retry chain can be purged in any order.
    await tx`UPDATE rp.session SET parent_session_id = NULL WHERE parent_session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.analytics_fact WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.retry_plan WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.evaluation_run WHERE session_id = ANY(${ids})`;   // cascades evidence, scores, findings, reports
    await tx`DELETE FROM rp.transcript_snapshot WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.disclosure_event WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.turn_analysis WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.operation WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.job WHERE payload->>'session_id' = ANY(${ids})`;
    await tx`DELETE FROM rp.turn WHERE session_id = ANY(${ids})`;
    await tx`DELETE FROM rp.session WHERE id = ANY(${ids})`;
    await audit(actor, 'retention.purged', 'tenant', tenantId, { sessions: ids.length, older_than_days: days }, {}, tx as never);
  });
  return { purged: ids.length };
}
