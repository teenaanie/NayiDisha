import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../ui';
import {EmptyState} from '../../workspace-components';
import {operatorActor} from '@/modules/roleplay/service/auth';
import {listOperatorAssessments,MAX_ASSESSMENT_ATTEMPTS} from '@/modules/roleplay/service/assessment';
import {AttemptsForm} from './client';
import {STATE} from './labels';
export const dynamic='force-dynamic';

/** The candidate's profile, when the learner is a signed-in candidate. */
const candidateHref=(subject:string)=>subject.startsWith('nd:candidate:')?`/ops/candidates/${encodeURIComponent(subject.slice('nd:candidate:'.length))}`:null;

/**
 * Graded assessments across every candidate: scores, the full assessment behind each one,
 * and how many attempts each candidate has per scenario.
 */
export default async function Assessments({searchParams}:{searchParams:Promise<{q?:string}>}){
 await scopePage('ops');
 const actor=await operatorActor();
 if(!actor||!actor.roles.includes('operator'))return <main className="page"><div className="note bad">Your account cannot manage assessments yet. Ask an administrator to run the latest database migration and Practice coach seed.</div></main>;
 const {q=''}=await searchParams;
 const rows=await listOperatorAssessments(actor,{search:q});
 const taken=rows.filter(r=>r.attempts_used>0);
 const scored=taken.map(r=>r.attempts.find(a=>a.final_percent!=null)).filter(Boolean) as {final_percent:number}[];
 const avg=scored.length?Math.round(scored.reduce((n,a)=>n+Number(a.final_percent),0)/scored.length):null;
 const waiting=rows.filter(r=>r.practised&&r.attempts_used<r.attempts_allowed&&!r.attempts.some(a=>a.state==='active')).length;
 const review=rows.filter(r=>r.attempts.some(a=>a.state==='review_required')).length;
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Practice coach</div><h1>Assessments</h1>
   <p>Graded assessments for every candidate. Candidates see only their score sheet; open a score to see the full assessment with the transcript and evidence. Each candidate gets one attempt per scenario after a practice report. Set a higher number to allow more, or lower it to withdraw attempts not yet used. Every attempt stays on record.</p></div>
  <div className="tilegrid mb">
   <div className="stat"><div className="k">Candidates assessed</div><div className="v">{new Set(taken.map(r=>r.learner_id)).size}</div><div className="d">{taken.reduce((n,r)=>n+r.attempts_used,0)} graded attempts</div></div>
   <div className="stat"><div className="k">Average latest score</div><div className="v">{avg??'—'}{avg!=null&&<span className="small muted">/100</span>}</div><div className="d">latest scored attempt per candidate and scenario</div></div>
   <div className="stat"><div className="k">Can take an assessment now</div><div className="v">{waiting}</div><div className="d">practised, with an attempt left</div></div>
   <div className="stat"><div className="k">Under review</div><div className="v">{review}</div><div className="d">a reviewer must confirm a risk flag</div></div>
  </div>
  <form className="card card-body mb"><div className="grid g3"><div><label htmlFor="assessment-search">Candidate or scenario</label><input id="assessment-search" name="q" defaultValue={q} placeholder="Search assessments…"/></div><div className="btnrow"><button className="btn btn-primary">Search</button><Link className="btn" href="/ops/assessments">Clear</Link></div></div></form>
  <section className="card"><div className="card-head"><h2>{rows.length} {rows.length===1?'candidate and scenario':'candidates and scenarios'}</h2><span className="small muted">Newest activity first</span></div><div className="card-body tight">
   {!rows.length?<EmptyState title={q?'No matches':'No assessments yet'} description={q?'Try another name or scenario.':'Candidates appear here once they have a practice report or a graded attempt.'}/>:<div className="tblwrap"><table>
    <thead><tr><th>Candidate</th><th>Scenario</th><th>Latest score</th><th>Status</th><th className="num">Attempts</th><th>Last activity</th><th>Attempts allowed</th></tr></thead>
    <tbody>{rows.map(r=>{
     const latest=r.attempts[0];const href=candidateHref(r.subject);
     const live=r.grants.filter(g=>!g.revoked_at).length;
     return <tr key={`${r.learner_id}|${r.scenario_id}`}>
      <td>{href?<Link href={href}>{r.learner}</Link>:r.learner}</td>
      <td>{r.title??r.scenario_id}<div className="small muted">{r.scenario_id}</div></td>
      <td>{latest?<Link href={`/ops/assessments/${latest.session_id}`}>{latest.final_percent!=null?`${Math.round(Number(latest.final_percent))}/100 · ${latest.band_label}`:`Open (${STATE[latest.state]?.label??latest.state})`}</Link>:<span className="muted">Not taken</span>}
       {r.attempts.length>1&&<details className="small"><summary>All {r.attempts.length} attempts</summary><ol>{r.attempts.map(a=><li key={a.session_id}><Link href={`/ops/assessments/${a.session_id}`}>{a.final_percent!=null?`${Math.round(Number(a.final_percent))}/100 · ${a.band_label}`:STATE[a.state]?.label??a.state}</Link> <span className="muted">{fmtDateTime(a.started_at)}</span></li>)}</ol></details>}</td>
      <td>{latest?<Pill tone={STATE[latest.state]?.tone??'mute'}>{STATE[latest.state]?.label??latest.state}</Pill>:r.practised?<Pill tone="ok">ready</Pill>:<Pill>practice first</Pill>}</td>
      <td className="num">{r.attempts_used} of {r.attempts_allowed}</td>
      <td>{r.last_activity?fmtDateTime(r.last_activity):'—'}</td>
      <td><AttemptsForm learnerId={r.learner_id} scenarioId={r.scenario_id} used={r.attempts_used} allowed={r.attempts_allowed} max={MAX_ASSESSMENT_ATTEMPTS}/>
       {r.grants.length>0&&<details className="small"><summary>{live} extra allowed{r.grants.length>live?`, ${r.grants.length-live} withdrawn`:''}</summary><ul>{r.grants.map((g,i)=><li key={i} className={g.revoked_at?'muted':undefined}>{fmtDateTime(g.created_at)} by {g.granted_by}{g.reason?` — ${g.reason}`:''}{g.revoked_at?` (withdrawn ${fmtDateTime(g.revoked_at)} by ${g.revoked_by})`:''}</li>)}</ul></details>}</td>
     </tr>;})}</tbody>
   </table></div>}
  </div></section>
 </main>;
}
