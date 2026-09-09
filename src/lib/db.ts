import postgres from 'postgres';

/**
 * Single Postgres connection for the whole app.
 *
 * The local prototype and Supabase run the same engine, so the only difference
 * between environments is DATABASE_URL. Supabase's pooled connection string
 * needs prepare:false — harmless locally, required there.
 */
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://postgres@127.0.0.1:5433/frontline';

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

/**
 * On Vercel every serverless instance holds its own pool, so a generous `max`
 * multiplies into connection exhaustion on Supabase's free tier. A local dev
 * server wants a few more.
 *
 * `max: 1` on serverless was a mistake worth recording. A transaction holds its
 * connection for its whole life, so any helper inside `sql.begin` that reaches
 * for the global `sql` instead of the transaction handle waits on a connection
 * that cannot be released until the transaction it is blocking finishes. With a
 * pool of one that is a permanent hang, and postgres.js has no pool-acquire
 * timeout to turn it into an error — the request simply never returns. It cost
 * a working demo to find. The helpers now take a connection (see `nextId`), and
 * the floor of 2 means a case anyone misses later degrades into slowness rather
 * than a silent deadlock.
 *
 * `prepare: false` is required either way — Supabase's poolers run pgbouncer,
 * which does not support prepared statements in transaction mode.
 */
const serverless = !!process.env.VERCEL || !!process.env.NETLIFY;

// PG_POOL_MAX exists so the acceptance suite can run the whole application
// against a one-connection pool — the condition that turns a mis-threaded
// transaction into a hang. See `npm run test:serverless`.
const poolMax = Number(process.env.PG_POOL_MAX) || (serverless ? 3 : 10);

export const sql =
  global.__sql ??
  postgres(connectionString, {
    prepare: false,
    max: poolMax,
    idle_timeout: serverless ? 20 : 0,
    connect_timeout: 15,
    transform: { undefined: null },
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== 'production') global.__sql = sql;

export type Sql = typeof sql;
