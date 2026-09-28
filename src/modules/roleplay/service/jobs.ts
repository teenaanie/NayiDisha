import { sql } from '@/lib/db';
import { logError, metric } from './context';

/**
 * Durable job queue on Postgres (spec §5, §24).
 *
 * A job is claimed with a lease (FOR UPDATE SKIP LOCKED), so two workers never
 * run it at once and a crashed worker's job becomes claimable again when its
 * lease lapses. Failures back off exponentially with jitter. Idempotency keys
 * make enqueueing the same work twice a no-op.
 *
 * Handlers are registered by the modules that own the work; `drain()` runs
 * from `after()` in API requests and from `npm run rp:worker`.
 */

export type JobKind = 'customer_turn' | 'evaluate' | 'coach' | 'project_analytics';
export interface Job { id: string; tenant_id: string; kind: JobKind; payload: Record<string, unknown>; attempts: number; max_attempts: number }
export class PermanentJobError extends Error {}

type Handler = (job: Job) => Promise<void>;
type Failed = (job: Job, error: unknown) => Promise<void>;
const handlers = new Map<JobKind, { run: Handler; exhausted?: Failed }>();
export function registerHandler(kind: JobKind, run: Handler, exhausted?: Failed) { handlers.set(kind, { run, exhausted }); }

type Tx = typeof sql;
export async function enqueue(conn: Tx, tenantId: string, kind: JobKind, key: string, payload: Record<string, unknown>, maxAttempts = 3) {
  await conn`
    INSERT INTO rp.job (tenant_id, kind, idempotency_key, payload, status, max_attempts)
    VALUES (${tenantId}, ${kind}, ${key}, ${conn.json(payload as never)}, 'queued', ${maxAttempts})
    ON CONFLICT (idempotency_key) DO NOTHING`;
}

const LEASE_SECONDS = Number(process.env.RP_JOB_LEASE_SECONDS ?? 120);

async function claim(kinds?: JobKind[]): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    UPDATE rp.job SET status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
     WHERE id = (
       SELECT id FROM rp.job
        WHERE ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND lease_until < now()))
          AND (${kinds ?? null}::text[] IS NULL OR kind = ANY(${kinds ?? null}::text[]))
        ORDER BY run_after, created_at
        FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, tenant_id, kind, payload, attempts, max_attempts`;
  return job ?? null;
}

export async function runOne(kinds?: JobKind[]): Promise<boolean> {
  const job = await claim(kinds);
  if (!job) return false;
  const h = handlers.get(job.kind);
  const started = Date.now();
  try {
    if (!h) throw new PermanentJobError(`No handler for ${job.kind}`);
    await h.run(job);
    await sql`UPDATE rp.job SET status = 'succeeded', lease_until = NULL, updated_at = now() WHERE id = ${job.id}`;
    await metric('job_succeeded', Date.now() - started, { kind: job.kind, attempt: job.attempts }, job.tenant_id);
  } catch (e) {
    const permanent = e instanceof PermanentJobError || job.attempts >= job.max_attempts;
    const backoff = Math.min(60, 2 ** job.attempts) + Math.random();
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await sql`
      UPDATE rp.job SET status = ${permanent ? 'failed' : 'queued'}, last_error = ${msg}, lease_until = NULL,
             run_after = now() + make_interval(secs => ${backoff}), updated_at = now() WHERE id = ${job.id}`;
    logError(`job:${job.kind}`, e, { job_id: job.id });
    await metric(permanent ? 'job_failed' : 'job_retry', 1, { kind: job.kind, attempt: job.attempts }, job.tenant_id);
    if (permanent && h?.exhausted) { try { await h.exhausted(job, e); } catch (x) { logError(`job:${job.kind}:exhausted`, x, { job_id: job.id }); } }
  }
  return true;
}

/** Run ready jobs until none remain or the time budget is spent. */
export async function drain(opts: { maxJobs?: number; budgetMs?: number; kinds?: JobKind[] } = {}) {
  const until = Date.now() + (opts.budgetMs ?? 20000);
  let n = 0;
  while (n < (opts.maxJobs ?? 50) && Date.now() < until) {
    if (!(await runOne(opts.kinds))) break;
    n++;
  }
  return n;
}
