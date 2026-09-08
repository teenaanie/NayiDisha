import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/frontline';
const sql = postgres(url, { prepare: false, onnotice: () => {} });

async function main() {
  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    process.stdout.write(`  applying ${f} ... `);
    await sql.unsafe(readFileSync(join(dir, f), 'utf8'));
    console.log('ok');
  }
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'app'
  `;
  console.log(`\nSchema ready: ${count} tables in schema "app".`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
