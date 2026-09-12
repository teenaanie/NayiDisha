import { poolMax } from './db';

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, instead of
 * either a fully sequential `for` loop (slow — every item's round trips wait
 * on the previous item's) or an unbounded `Promise.all` (which just queues on
 * the DB connection pool anyway, since the pool is deliberately tiny on
 * serverless — see `poolMax` in `db.ts`).
 */
export async function mapWithConcurrency<T, R>(
  items: T[], fn: (item: T, index: number) => Promise<R>, limit = poolMax,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
