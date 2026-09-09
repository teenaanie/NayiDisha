import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import postgres from 'postgres';
const sql=postgres(process.env.DATABASE_URL??'postgres://postgres@127.0.0.1:5433/frontline',{prepare:false,onnotice:()=>{}});
async function main(){
 const reset=process.argv.includes('--reset');
 if(reset && process.env.ALLOW_DEMO_RESET!=='true')throw new Error('Set ALLOW_DEMO_RESET=true only for a disposable or explicitly approved demo reset.');
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
