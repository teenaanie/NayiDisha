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
 * multiplies into connection exhaustion on Supabase's free tier. One
 * connection per instance is correct there; a local dev server wants a few.
 *
 * `prepare: false` is required either way — Supabase's poolers run pgbouncer,
 * which does not support prepared statements in transaction mode.
 */
const serverless = !!process.env.VERCEL || !!process.env.NETLIFY;

export const sql =
  global.__sql ??
  postgres(connectionString, {
    prepare: false,
    max: serverless ? 1 : 10,
    idle_timeout: serverless ? 20 : 0,
    connect_timeout: 15,
    transform: { undefined: null },
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== 'production') global.__sql = sql;

export type Sql = typeof sql;
