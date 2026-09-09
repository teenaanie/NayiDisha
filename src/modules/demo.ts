import {sql} from '@/lib/db';
import snapshot from '../../db/demo-snapshot.json';
/** Atomic restore of synthetic demo records; schema and migration history are retained. */
export async function resetDemo(confirmation:string){
 if(process.env.ALLOW_DEMO_RESET!=='true'||confirmation!=='RESET DEMO')throw new Error('Reset is disabled. It requires ALLOW_DEMO_RESET=true and the exact confirmation RESET DEMO.');
 await sql.begin(async tx=>{
 await tx`SELECT pg_advisory_xact_lock(727001)`;
 const names=snapshot.map(s=>'app."'+s.table+'"').join(',');
 await tx.unsafe('TRUNCATE '+names+' RESTART IDENTITY');
 for(const table of snapshot){for(const row of [...table.rows].sort((a:any,b:any)=>String(a.id||'').localeCompare(String(b.id||''),undefined,{numeric:true}))){const values:Record<string,any>={...row};for(const key of table.jsonColumns)if(key in values&&values[key]!==null)values[key]=tx.json(values[key]);await tx`INSERT INTO ${tx.unsafe('app."'+table.table+'"')} ${tx(values)}`;}}
 await tx`INSERT INTO app.action_audit(actor,role,action,detail) VALUES('ADMIN','ADMIN','DEMO_RESET','{"source":"canonical synthetic snapshot"}')`;
 });
}
