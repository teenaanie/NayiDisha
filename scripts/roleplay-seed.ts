/** Seed the roleplay platform (idempotent). Local or explicitly approved databases only. */
import { sql } from '../src/lib/db';
import { seedRoleplay } from '../src/modules/roleplay/service/seed';
seedRoleplay().then(async () => { console.log('Roleplay seed complete.'); await sql.end(); }).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
