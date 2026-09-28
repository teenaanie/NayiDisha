/** Retention purge for every tenant, by each tenant's retention_days (spec §23). */
import { sql } from '../src/lib/db';
import { purgeExpired } from '../src/modules/roleplay/service';
async function main() {
  for (const t of await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM rp.tenant`) {
    const r = await purgeExpired(null, t.id);
    console.log(`${t.slug}: purged ${r.purged} session(s)`);
  }
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
