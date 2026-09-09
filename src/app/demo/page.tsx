import {Controls} from './controls';
import {identity} from '@/lib/auth';
import {sql} from '@/lib/db';
import {login,switchPersona} from './actions';
export default async function Demo(){
 const admin=await identity('nd_admin');
 if(!admin)return <main className="page"><h1>Demo administrator sign-in</h1><form action={login}><label>Password<input type="password" name="password" required/></label><button className="btn btn-primary">Sign in</button></form><p><a href="/wa">Start a new candidate journey</a></p></main>;
 const [flags]=await sql`SELECT messaging_failure,payout_failure FROM app.demo_clock WHERE id=1`;
 const [employers,partners,candidates]=await Promise.all([sql`SELECT id,brand_name AS name FROM app.employer_organisation`,sql`SELECT id,name FROM app.partner`,sql`SELECT id,name FROM app.candidate WHERE status='PROFILE_ACTIVE'`]);
 return <main className="page"><h1>Demo identities</h1><p>Only the demo administrator can impersonate users. Each selected view enforces that user’s permissions.</p><form action={switchPersona}><select name="persona"><option value="ADMIN:ADMIN-001">Administrator — all demo controls</option><option value="OPERATIONS:OPS-001">Operations</option><option value="FINANCE:FIN-001">Finance</option>{[['EMPLOYER',employers],['PARTNER',partners],['CANDIDATE',candidates]].map(([role,rows])=>(rows as any[]).map(row=><option key={row.id} value={role+':'+row.id}>{role} · {row.name||row.id}</option>))}</select><button className="btn btn-primary">Open selected view</button></form>{(await identity())?.role==='ADMIN'&&<Controls messaging={flags.messaging_failure} payout={flags.payout_failure}/>}</main>;
}
