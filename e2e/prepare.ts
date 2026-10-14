import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from './env';

/**
 * A fresh local database for the browser tests: drop, create, migrate, seed the job portal and
 * the practice coach. Refuses anything but a database on this machine (never the live Supabase).
 */
/**
 * When nothing listens on the local port, start the tests' own Postgres in .e2e/pgdata (git-ignored),
 * creating it the first time. Needs the Postgres binaries on PATH (Homebrew: brew install postgresql).
 */
async function ensureLocalServer(url: URL) {
  const probe = postgres(E2E_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), { max: 1, connect_timeout: 3, onnotice: () => {} });
  try { await probe`SELECT 1`; return; } catch { /* not running */ } finally { await probe.end({ timeout: 1 }).catch(() => {}); }
  const dir = join(process.cwd(), '.e2e', 'pgdata');
  if (!existsSync(join(dir, 'PG_VERSION'))) { mkdirSync(dir, { recursive: true }); execSync(`initdb -D "${dir}" -U postgres -A trust --no-locale -E UTF8`, { stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } }); }
  // macOS: without a locale the server stops with "postmaster became multithreaded during startup".
  execSync(`pg_ctl -D "${dir}" -o "-p ${url.port || 5432} -k ''" -l "${join(process.cwd(), '.e2e', 'postgres.log')}" -w start`, { stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
  console.log(`Started the local test Postgres on port ${url.port || 5432} (.e2e/pgdata)`);
}

async function main() {
  const url = new URL(E2E_DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) throw new Error(`E2E database must be local, got ${url.hostname}`);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes('e2e')) throw new Error(`E2E database name must contain "e2e", got "${name}"`);
  await ensureLocalServer(url);
  const admin = postgres(E2E_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  for (const cmd of ['npm run -s db:migrate', 'npm run -s db:seed', 'npm run -s rp:seed']) execSync(cmd, { env, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`E2E database ready: ${name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
