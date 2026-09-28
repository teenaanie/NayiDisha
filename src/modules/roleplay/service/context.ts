import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';

/**
 * Request context for the roleplay platform: who is acting, in which tenant,
 * with which roles, and how errors, audit and metrics are recorded.
 *
 * Tenant and learner identity always come from here, never from request
 * bodies (spec §18). Every repository query in the platform filters on
 * actor.tenant_id; an object in another tenant is indistinguishable from one
 * that does not exist (404), so IDs leak nothing (AT21).
 */

export type Role = 'learner' | 'manager' | 'author' | 'reviewer' | 'tenant_admin' | 'worker';
export interface Actor {
  tenant_id: string;
  tenant_slug: string;
  user_id: string;
  subject: string;
  display_name: string;
  roles: Role[];
  managed_team_ids: string[];
  request_id: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false, readonly details: Record<string, unknown> = {}) { super(message); }
}
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const forbidden = (msg = 'You do not have permission for this action.') => new ApiError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details: Record<string, unknown> = {}) => new ApiError(409, code, msg, false, details);

export function requireRole(actor: Actor, ...roles: Role[]) {
  if (!roles.some((r) => actor.roles.includes(r))) throw forbidden();
}

/** Load a user's current roles and managed teams. */
export async function actorFor(tenantId: string, subject: string, requestId: string = randomUUID()): Promise<Actor | null> {
  const [u] = await sql<{ id: string; display_name: string; slug: string; tstatus: string; ustatus: string }[]>`
    SELECT u.id, u.display_name, t.slug, t.status tstatus, u.status ustatus
      FROM rp.app_user u JOIN rp.tenant t ON t.id = u.tenant_id
     WHERE u.tenant_id = ${tenantId} AND u.subject = ${subject}`;
  if (!u || u.tstatus !== 'active' || u.ustatus !== 'active') return null;
  const [roles, teams] = await Promise.all([
    sql<{ role: Role }[]>`SELECT role FROM rp.membership WHERE user_id = ${u.id} AND tenant_id = ${tenantId} AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
    sql<{ team_id: string }[]>`SELECT team_id FROM rp.team_membership WHERE user_id = ${u.id} AND tenant_id = ${tenantId} AND role = 'manager' AND (valid_to IS NULL OR valid_to > now())`,
  ]);
  return { tenant_id: tenantId, tenant_slug: u.slug, user_id: u.id, subject, display_name: u.display_name, roles: roles.map((r) => r.role), managed_team_ids: teams.map((t) => t.team_id), request_id: requestId };
}

// ---- audit ------------------------------------------------------------------

type Tx = typeof sql;
export async function audit(actor: Actor | null, action: string, subjectType: string, subjectId: string | null, detail: Record<string, unknown> = {}, hashes: { before?: string | null; after?: string | null } = {}, conn: Tx = sql) {
  await conn`
    INSERT INTO rp.audit_event (tenant_id, actor_id, actor_roles, action, subject_type, subject_id, before_hash, after_hash, request_id, detail)
    VALUES (${actor?.tenant_id ?? null}, ${actor?.user_id ?? null}, ${conn.json((actor?.roles ?? []) as never)}, ${action}, ${subjectType}, ${subjectId},
            ${hashes.before ?? null}, ${hashes.after ?? null}, ${actor?.request_id ?? null}, ${conn.json(detail as never)})`;
}

// ---- observability ------------------------------------------------------------

/**
 * Metrics carry IDs, counts and durations only. Utterances, facts and prompts
 * never reach logs or metric tags (spec §23).
 */
const SAFE_TAG = /^[A-Za-z0-9_.:@/-]{0,80}$/;
export async function metric(name: string, value: number, tags: Record<string, string | number | boolean | null> = {}, tenantId: string | null = null) {
  const clean = Object.fromEntries(Object.entries(tags).filter(([, v]) => v === null || typeof v !== 'string' || SAFE_TAG.test(v)));
  if (process.env.RP_LOG_METRICS !== '0') console.log(JSON.stringify({ at: new Date().toISOString(), kind: 'rp_metric', name, value, tenant_id: tenantId, ...clean }));
  try { await sql`INSERT INTO rp.metric_event (tenant_id, name, value, tags) VALUES (${tenantId}, ${name}, ${value}, ${sql.json(clean as never)})`; }
  catch { /* metrics must never break the request */ }
}

export function logError(where: string, e: unknown, ids: Record<string, string | null | undefined> = {}) {
  // Error messages from our own code are safe; provider bodies are never included.
  const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message.slice(0, 200) : 'unknown';
  console.error(JSON.stringify({ at: new Date().toISOString(), kind: 'rp_error', where, message, ...ids }));
}
