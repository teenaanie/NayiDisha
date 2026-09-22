import {writeFileSync} from 'node:fs';import {sql} from '../src/lib/db';
// The snapshot must only ever be captured from a disposable database, or a
// drifted one silently becomes the canonical dataset. The original rule was a
// database literally named nayidisha_test; ALLOW_DEMO_RESET is accepted as the
// same statement of intent, since it is already the flag that authorises
// dropping the whole schema in migrate --reset and resetDemo.
async function main(){if(!process.env.DATABASE_URL?.includes('nayidisha_test')&&process.env.ALLOW_DEMO_RESET!=='true')throw new Error('Only capture a disposable seed database: use one named nayidisha_test, or set ALLOW_DEMO_RESET=true to confirm this database is disposable.');
const tables=await sql`SELECT tablename FROM pg_tables WHERE schemaname='app' ORDER BY tablename`;
const edges=await sql`SELECT c.relname AS child,p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE f.contype='f' AND n.nspname='app' AND c.relname<>p.relname`;
const ordered:string[]=[];let pending=tables.map(t=>String(t.tablename));while(pending.length){const ready=pending.filter(t=>edges.filter(e=>e.child===t).every(e=>ordered.includes(e.parent)));if(!ready.length)throw new Error('Cyclic dependencies');ordered.push(...ready);pending=pending.filter(t=>!ready.includes(t));}
const snapshot=[];for(const table of ordered){const cols=await sql`SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema='app' AND table_name=${table} ORDER BY ordinal_position`;const rows=await sql.unsafe('SELECT * FROM app."'+table+'"');snapshot.push({table,jsonColumns:cols.filter(c=>['json','jsonb'].includes(c.udt_name)).map(c=>c.column_name),rows});}
writeFileSync('db/demo-snapshot.json',JSON.stringify(snapshot,null,2));await sql.end();}
main().catch(e=>{console.error(e);process.exit(1)});
