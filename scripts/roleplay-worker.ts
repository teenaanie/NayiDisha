/**
 * Roleplay job worker. The API drains jobs after each request; this process
 * drains continuously so abandoned leases and backoffs are picked up even when
 * nobody is using the app. `--once` drains and exits (useful from cron).
 */
import { sql } from '../src/lib/db';
import { drain } from '../src/modules/roleplay/service';
async function main() {
  const once = process.argv.includes('--once');
  do {
    const n = await drain({ budgetMs: 30000 });
    if (n) console.log(JSON.stringify({ at: new Date().toISOString(), kind: 'rp_worker', jobs: n }));
    if (!once) await new Promise((r) => setTimeout(r, 2000));
  } while (!once);
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
