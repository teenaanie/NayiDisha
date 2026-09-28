import { sql } from '@/lib/db';
import { canonicalJson, sha256 } from '../config/compile';
import { ApiError, conflict, type Actor } from './context';

/** Limits from spec §7, shown to the learner before practice. */
export const LIMITS = {
  max_message_chars: 4000,
  max_learner_turns: 100,
  idle_expiry_minutes: 60,
  reminder_minutes: [10, 12],
};

// ---- idempotency (spec §18) ---------------------------------------------------

/**
 * Run `fn` once per (actor, route, key). A replay with the same request
 * returns the stored response; a replay with a different request is a 409.
 * The key row is claimed before work starts, so two concurrent identical
 * requests cannot both run.
 */
export async function idempotent<T>(actor: Actor, route: string, key: string | null, request: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8–128 characters) with this request.');
  const hash = sha256(canonicalJson(request ?? null));
  const [claimed] = await sql<{ key: string }[]>`
    INSERT INTO rp.idempotency (tenant_id, actor_id, route, key, request_hash) VALUES (${actor.tenant_id}, ${actor.user_id}, ${route}, ${key}, ${hash})
    ON CONFLICT (actor_id, route, key) DO NOTHING RETURNING key`;
  if (!claimed) {
    const [prior] = await sql<{ request_hash: string; response_status: number | null; response_body: T | null }[]>`
      SELECT request_hash, response_status, response_body FROM rp.idempotency WHERE actor_id = ${actor.user_id} AND route = ${route} AND key = ${key}`;
    if (prior.request_hash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
    if (prior.response_status === null) throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'The original request is still being processed.', true);
    return { status: prior.response_status, body: prior.response_body as T, replayed: true };
  }
  try {
    const res = await fn();
    await sql`UPDATE rp.idempotency SET response_status = ${res.status}, response_body = ${sql.json(res.body as never)} WHERE actor_id = ${actor.user_id} AND route = ${route} AND key = ${key}`;
    return { ...res, replayed: false };
  } catch (e) {
    // A failed attempt releases the key so the client can retry it.
    await sql`DELETE FROM rp.idempotency WHERE actor_id = ${actor.user_id} AND route = ${route} AND key = ${key}`;
    throw e;
  }
}

// ---- rate and budget limits (spec §7, §23) --------------------------------------

async function bump(tenantId: string, actorId: string | null, bucket: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO rp.usage_counter (tenant_id, actor_id, bucket, count) VALUES (${tenantId}, ${actorId ?? '00000000-0000-0000-0000-000000000000'}, ${bucket}, 1)
    ON CONFLICT (tenant_id, bucket, actor_id) DO UPDATE SET count = rp.usage_counter.count + 1 RETURNING count`;
  return row.count;
}

/** Defaults per learner per minute; a tenant can override with settings.rate_limits. */
const RATE_DEFAULTS = { turn: 20, start: 10, finish: 10 };
export async function rateLimit(actor: Actor, action: 'turn' | 'start' | 'finish', fallback?: number) {
  const [t] = await sql<{ settings: { rate_limits?: Partial<typeof RATE_DEFAULTS> } }[]>`SELECT settings FROM rp.tenant WHERE id = ${actor.tenant_id}`;
  const perMinute = t?.settings?.rate_limits?.[action] ?? fallback ?? RATE_DEFAULTS[action];
  const minute = new Date().toISOString().slice(0, 16);
  const n = await bump(actor.tenant_id, actor.user_id, `${action}:${minute}`);
  if (n > perMinute) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', true, { retry_after_seconds: 60 - new Date().getSeconds() });
}

/** Tenant-wide daily provider-call budget. Hitting it preserves progress and is recoverable. */
export async function spendProviderBudget(tenantId: string) {
  const [t] = await sql<{ settings: { daily_provider_call_budget?: number } }[]>`SELECT settings FROM rp.tenant WHERE id = ${tenantId}`;
  const cap = t?.settings?.daily_provider_call_budget;
  const n = await bump(tenantId, null, `provider_calls:${new Date().toISOString().slice(0, 10)}`);
  if (cap && n > cap) throw new ApiError(429, 'BUDGET_EXHAUSTED', 'Today\'s practice budget is used up. Your conversation is saved; try again tomorrow or ask your administrator.', true);
}
