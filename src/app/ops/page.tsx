import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import {sql} from '@/lib/db';
import {now,fmtDateTime} from '@/lib/clock';
import {StatusPill,Money} from '../ui';
import {Icon,SunriseArt} from './dashboard-icon';
import {dashboardData,metricDefinitions} from './dashboard-data';
export const dynamic='force-dynamic';

/** Jobs roll up into the four states an operator acts on, in the order the legend shows them. */
const JOB_GROUPS=[
 {label:'Open',key:'open',statuses:['LIVE']},
 {label:'Closed',key:'closed',statuses:['CLOSED','FILLED','EXPIRED']},
 {label:'In review',key:'review',statuses:['PENDING_APPROVAL']},
 {label:'On hold / draft',key:'hold',statuses:[]},
];

export default async function OpsDashboard(){
 await scopePage('ops');
 const {counts:c,jobs}=await dashboardData();
 const date=await now();
 const employers=await sql`SELECT e.id,e.brand_name,e.legal_name,e.gst_pan,e.status,e.created_at,(SELECT count(*) FROM app.job j WHERE j.employer_id=e.id) jobs FROM app.employer_organisation e ORDER BY e.created_at DESC,e.id LIMIT 5`;

 const queue=[['emp_pending','Employers awaiting verification','/ops/employers','building'],['par_pending','Partners awaiting verification','/ops/partners','users'],['job_pending','Jobs awaiting approval','/ops/jobs','job'],['attr_review','Referral disputes','/ops/attribution','link'],['exceptions','Workflow exceptions','/ops/exceptions','alert'],['credit_pending','Pending credit requests','/ops/credit-requests','file'],['dr_open','Open data requests','/ops/data-requests','lock'],['repl_pending','Replacement claims','/ops/replacements','shield'],['fraud_open','Open fraud cases','/ops/fraud','alert'],['cfg_sandbox','Draft configurations','/ops/configurations','settings']];
 const attentionTotal=queue.reduce((s,[k])=>s+Number(c[k as string]),0);

 const groups=JOB_GROUPS.map((g)=>({...g,n:0}));
 for(const j of jobs){const hit=groups.find((g)=>g.statuses.includes(j.status));(hit||groups[3]).n+=Number(j.n);}
 const totalJobs=groups.reduce((s,g)=>s+g.n,0);

 const stages=[['candidates','Registered'],['assessed','Assessed'],['applied_candidates','Applied'],['selected_candidates','Selected'],['hired_candidates','Hired']];
 const actions=[['/ops/new-employer','Add employer','building'],['/ops/new-partner','Add partner','users'],['/ops/jobs','Review jobs','job'],['/ops/candidates','View candidates','users'],['/ops/matches','Run matching','spark'],['/ops/reports','Create report','chart']];

 return <main className="page nd-dashboard">
  <div className="nd-greeting">
   <SunriseArt/>
   <div className="nd-greeting-copy">
    <h1>A new day. A new direction. <span>☀</span></h1>
    <p>Here’s what’s happening on NayiDisha today.</p>
   </div>
   <p className="nd-script" aria-hidden="true">More opportunities,<br/>a brighter tomorrow.</p>
   <div className="nd-date">
    <Icon name="calendar"/>
    <div>
     <strong>{date.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'short',year:'numeric'})}</strong>
     <small>{date.toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false})} IST · Demo clock</small>
    </div>
   </div>
  </div>

  <section aria-label="Placement overview" className="nd-metrics">
   {metricDefinitions.map(([key,label,description,icon,,href],i)=>
    <Link href={href} className={`nd-metric ${i<4?'nd-primary':''}`} key={key}>
     <span className="nd-metric-icon"><Icon name={icon}/></span>
     <div>
      <strong className="nd-value">{key==='referral_paise'?<Money paise={c[key]}/>:String(c[key])}</strong>
      <h2>{label}</h2>
      <p>{description}</p>
     </div>
     {i<4&&<span className="nd-metric-go" aria-hidden="true"><Icon name="chevron"/></span>}
    </Link>)}
  </section>

  <div className="nd-dashboard-grid">
   <section className="nd-panel nd-funnel">
    <div className="nd-panel-head">
     <div className="nd-panel-title"><span className="nd-panel-icon"><Icon name="chart"/></span><div><h2>Application funnel</h2><p>Unique candidates at each stage</p></div></div>
     <span className="nd-period">All time <i aria-hidden="true">⌄</i></span>
    </div>
    <div className="nd-stages">
     {stages.map(([key,label],i)=>{
      const percentage=Number(c.candidates)?Math.round(Number(c[key])/Number(c.candidates)*100):0;
      return <div key={key} className={`nd-stage-col step-${i+1}`}>
       <div className="nd-stage"><strong>{String(c[key])}</strong><span>{label}</span></div>
       <div className="nd-stage-bar" role="img" aria-label={`${label}: ${percentage}% of registered candidates`}><i style={{width:`${percentage}%`}}/></div>
       <small>{percentage}%</small>
      </div>;
     })}
    </div>
    <p className="nd-footnote">Candidates may apply to more than one job. Selected includes candidates who joined.</p>
   </section>

   <section className="nd-panel nd-job-status">
    <div className="nd-panel-head">
     <div className="nd-panel-title"><span className="nd-panel-icon"><Icon name="chart"/></span><h2>Jobs by status</h2></div>
     <Link href="/ops/jobs">View all →</Link>
    </div>
    <div className="nd-status-body">
     <div className="nd-status-total"><strong>{totalJobs}</strong><span>Total jobs</span></div>
     <div className="nd-status-detail">
      <div className="nd-status-bar" role="img" aria-label={`${totalJobs} jobs: ${groups.map((g)=>`${g.n} ${g.label}`).join(', ')}`}>
       {groups.filter((g)=>g.n>0).map((g)=><i key={g.key} className={`seg-${g.key}`} style={{flexGrow:g.n}}/>)}
       {!totalJobs&&<i className="seg-empty" style={{flexGrow:1}}/>}
      </div>
      <ul>{groups.map((g)=><li key={g.key}><i className={`seg-${g.key}`}/><span>{g.label}</span><strong>{g.n}</strong></li>)}</ul>
     </div>
    </div>
   </section>

   <section className="nd-panel nd-quick">
    <div className="nd-panel-head">
     <div className="nd-panel-title"><span className="nd-panel-icon nd-gold"><Icon name="bolt"/></span><h2>Quick actions</h2></div>
    </div>
    <div className="nd-quick-actions">
     {actions.map(([href,label,icon])=><Link href={href} key={href}>
      <Icon name={icon}/><span>{label}</span><i aria-hidden="true"><Icon name="chevron"/></i>
     </Link>)}
    </div>
   </section>

   <section className="nd-panel nd-attention" id="attention">
    <div className="nd-panel-head">
     <div className="nd-panel-title"><span className="nd-panel-icon nd-gold"><Icon name="alert"/></span><h2>Needs attention</h2></div>
     <div className="nd-panel-actions"><span className="nd-count-pill">{attentionTotal} items</span><Link href="/ops/exceptions">View all →</Link></div>
    </div>
    <div className="nd-queue">
     {queue.map(([key,label,href,icon])=><Link className="nd-queue-row" href={href} key={key}>
      <span className="nd-queue-icon"><Icon name={icon}/></span>
      <span>{label}</span>
      <strong className={Number(c[key])?'nd-pending':''}>{String(c[key])}</strong>
      <i aria-hidden="true"><Icon name="chevron"/></i>
     </Link>)}
    </div>
   </section>

   <section className="nd-panel nd-employers">
    <div className="nd-panel-head">
     <div className="nd-panel-title"><span className="nd-panel-icon"><Icon name="building"/></span><h2>Recent employers</h2></div>
     <Link href="/ops/employers">View all →</Link>
    </div>
    <div className="tblwrap"><table>
     <thead><tr><th>ID</th><th>Employer</th><th>GST / PAN</th><th>Jobs</th><th>Status</th><th>Date added</th><th><span className="nd-sr-only">Actions</span></th></tr></thead>
     <tbody>{employers.map((e)=><tr key={e.id}>
      <td className="id">{e.id}</td>
      <td><div className="nd-employer-name"><span className="nd-letter">{(e.brand_name||e.legal_name).slice(0,1)}</span><strong>{e.brand_name||e.legal_name}</strong></div></td>
      <td className="small">{e.gst_pan||'—'}</td>
      <td>{String(e.jobs)}</td>
      <td><StatusPill status={e.status}/></td>
      <td className="small muted">{fmtDateTime(e.created_at).split(',')[0]}</td>
      <td><Link className="nd-row-edit" href={`/ops/employers/${e.id}/edit`} aria-label={`Edit ${e.brand_name||e.legal_name}`}>Edit <Icon name="chevron"/></Link></td>
     </tr>)}</tbody>
    </table>{!employers.length&&<p className="empty">No employers yet. Add your first employer to get started.</p>}</div>
   </section>
  </div>
 </main>;
}
