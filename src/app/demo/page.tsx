import {Controls} from './controls';
import {identity} from '@/lib/auth';
import {sql} from '@/lib/db';
import {login,switchPersona,findCandidate} from './actions';
export default async function Demo({searchParams}:{searchParams:Promise<{error?:string}>}){
 const {error}=await searchParams;
 const admin=await identity('nd_admin');
 if(!admin)return <main className="page"><h1>Demo administrator sign-in</h1>{error&&<p className="note bad">{error}</p>}<form action={login}><label>Password<input type="password" name="password" required/></label><button className="btn btn-primary">Sign in</button></form><p><a href="/wa">Start a new candidate journey</a></p></main>;
 const [flags]=await sql`SELECT messaging_failure,payout_failure FROM app.demo_clock WHERE id=1`;
 // Employers/partners are curated by Operations and stay few, so a capped list
 // is still a real picker. Candidates are self-service and unbounded — every
 // completed WhatsApp journey adds one — so they are looked up, not listed
 // (with a small "recent" shortcut for convenience).
 const [employers,partners,recentCandidates]=await Promise.all([
  sql<{id:string;name:string}[]>`SELECT id,brand_name AS name FROM app.employer_organisation ORDER BY id DESC LIMIT 20`,
  sql<{id:string;name:string}[]>`SELECT id,name FROM app.partner ORDER BY id DESC LIMIT 20`,
  sql<{id:string;name:string|null}[]>`SELECT id,name FROM app.candidate WHERE status='PROFILE_ACTIVE' ORDER BY id DESC LIMIT 8`,
 ]);
 return <main className="page">
  <h1>Demo identities</h1>
  <p>Only the demo administrator can impersonate users. Each selected view enforces that user&rsquo;s permissions.</p>
  <p>For the account activation demo, approve an employer or partner and use Create / replace invitation on their Operations row. They accept the link, choose a password and use Sign in / out on later visits. Returning candidates use their original demo mobile number and simulated code 123456. Delivery remains simulated. The shortcuts below are an administrator convenience.</p>
  {error&&<p className="note bad">{error}</p>}

  <div className="grid g3 mb">
   <section className="card card-body">
    <h3>Platform</h3>
    <form action={switchPersona} className="btnrow" style={{flexDirection:'column',alignItems:'stretch',gap:6}}>
     <button className="btn" name="persona" value="ADMIN:ADMIN-001">Administrator — all demo controls</button>
     <button className="btn" name="persona" value="OPERATIONS:OPS-001">Operations</button>
     <button className="btn" name="persona" value="FINANCE:FIN-001">Finance</button>
    </form>
   </section>

   <section className="card card-body">
    <h3>Employers</h3>
    {employers.length
     ? <form action={switchPersona} className="btnrow" style={{flexDirection:'column',alignItems:'stretch',gap:6}}>
        {employers.map((e)=><button className="btn" key={e.id} name="persona" value={'EMPLOYER:'+e.id}>{e.name||e.id}</button>)}
       </form>
     : <p className="small muted">None yet.</p>}
   </section>

   <section className="card card-body">
    <h3>Partners</h3>
    {partners.length
     ? <form action={switchPersona} className="btnrow" style={{flexDirection:'column',alignItems:'stretch',gap:6}}>
        {partners.map((p)=><button className="btn" key={p.id} name="persona" value={'PARTNER:'+p.id}>{p.name||p.id}</button>)}
       </form>
     : <p className="small muted">None yet.</p>}
   </section>
  </div>

  <section className="card card-body" style={{maxWidth:560}}>
   <h3>Candidate</h3>
   <p className="small muted">Created continuously through the WhatsApp demo, so a candidate is looked up rather than listed.</p>
   <form action={findCandidate} className="btnrow">
    <input name="candidate" placeholder="Candidate ID or phone, e.g. CAN-001 or +910000000001" style={{flex:1,minWidth:220}}/>
    <button className="btn btn-primary">View</button>
   </form>
   {recentCandidates.length>0&&<>
    <p className="small muted mt">Recent:</p>
    <form action={switchPersona} className="btnrow">
     {recentCandidates.map((c)=><button className="btn btn-sm" key={c.id} name="persona" value={'CANDIDATE:'+c.id}>{c.id}{c.name?' · '+c.name.replace(/^DEMO /,''):''}</button>)}
    </form>
   </>}
  </section>

  {(await identity())?.role==='ADMIN'&&<Controls messaging={flags.messaging_failure} payout={flags.payout_failure}/>}
 </main>;
}
