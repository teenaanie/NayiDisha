import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import postgres from 'postgres';
const url=process.env.DATABASE_URL??'postgres://postgres@127.0.0.1:5433/frontline';
const sql=postgres(url,{prepare:false,onnotice:()=>{}});
const LOCAL_HOSTS=['localhost','127.0.0.1','::1','[::1]'];
/**
 * A reset drops every schema. `.env.local` usually points at the shared
 * Supabase demo, so a reset copied from local-setup instructions would wipe it:
 * that happened on 2026-09-28. A non-local reset therefore needs the target
 * host named explicitly, which cannot happen by accident.
 */
function assertResetAllowed(){
 if(process.env.ALLOW_DEMO_RESET!=='true')throw new Error('Set ALLOW_DEMO_RESET=true only for a disposable or explicitly approved demo reset.');
 let host='';
 try{host=new URL(url).hostname;}catch{throw new Error('DATABASE_URL is not a valid URL; refusing to reset.');}
 if(LOCAL_HOSTS.includes(host))return host;
 if(process.env.ALLOW_REMOTE_RESET!==host)throw new Error(
  `Refusing to reset the NON-LOCAL database at ${host}. This drops every schema and all its data.\n`+
  `If you really mean to reset that database, run again with ALLOW_REMOTE_RESET=${host}.\n`+
  `For local development, prefix the command with DATABASE_URL=postgres://postgres@127.0.0.1:5432/frontline.`);
 return host;
}
async function main(){
 const reset=process.argv.includes('--reset');
 if(reset)console.log(`Resetting database at ${assertResetAllowed()}`);
 await sql`CREATE TABLE IF NOT EXISTS public.nd_migration(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())`;
 if(reset)await sql`DELETE FROM public.nd_migration`;
 const [existing]=await sql`SELECT to_regclass('app.candidate') AS table_name`;
 if(existing.table_name&&!reset)for(const name of ['001_schema.sql','002_lifecycle.sql'])await sql`INSERT INTO public.nd_migration(name) VALUES(${name}) ON CONFLICT DO NOTHING`;
 for(const name of readdirSync(join(process.cwd(),'db/migrations')).filter(n=>n.endsWith('.sql')).sort()){
  if((await sql`SELECT 1 FROM public.nd_migration WHERE name=${name}`).length)continue;
  await sql.begin(async tx=>{await tx.unsafe(readFileSync(join(process.cwd(),'db/migrations',name),'utf8'));await tx`INSERT INTO public.nd_migration(name) VALUES(${name})`;});console.log('Applied '+name);
 }
 await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
