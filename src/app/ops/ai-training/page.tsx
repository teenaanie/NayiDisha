import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../ui';
import {EmptyState} from '../../workspace-components';
import {requestActor} from '@/modules/roleplay/service/auth';
import {listTrainingRuns} from '@/modules/roleplay/service/training';
import {StartRunForm} from './client';
import {RUN_STATUS} from './labels';
export const dynamic='force-dynamic';
// Starting a run also begins its first review step, which can take a couple of minutes.
export const maxDuration=300;

/** A datetime-local value in India time. */
const localInput=(d:Date)=>new Date(+d+5.5*3600000).toISOString().slice(0,16);
const when=(d:Date)=>+d===0?'the beginning':fmtDateTime(d);

/**
 * AI training agent: reviews assessed practice sessions and suggests improvements to the
 * customer replies, question understanding, scenario content, assessment and coaching. A
 * person reviews the suggestions; approval produces a build brief.
 */
export default async function AiTraining(){
 await scopePage('ops');
 const actor=await requestActor();
 if(!actor)return <main className="page"><div className="note bad">Sign in again to use the AI training agent.</div></main>;
 const {runs,watermark}=await listTrainingRuns(actor);
 const active=runs.find(r=>r.status==='analysing');
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Practice coach</div><h1>AI training</h1>
   <p>The training agent (Gemini Pro) reads the practice sessions assessed since the last run: what the AI customer said, how questions were understood, the scores and the coaching. It suggests improvements with exact quotes. You accept, edit or reject each one, and approval turns the accepted ones into a build brief for the next version. It never changes the live scenario by itself. A run also starts automatically every Monday morning.</p></div>
  <div className="tilegrid mb">
   <div className="stat"><div className="k">Reports assessed up to</div><div className="v" style={{fontSize:'1.1rem'}}>{watermark?fmtDateTime(watermark):'Not yet'}</div><div className="d">The next run starts here</div></div>
   <div className="stat"><div className="k">Runs</div><div className="v">{runs.length}</div><div className="d">{runs.filter(r=>r.status==='in_review').length} waiting for review</div></div>
   <div className="stat"><div className="k">Accepted suggestions</div><div className="v">{runs.reduce((n,r)=>n+r.accepted,0)}</div><div className="d">across all runs</div></div>
  </div>
  <section className="card mb"><div className="card-head"><h2>Run the training agent</h2></div><div className="card-body">
   <StartRunForm from={localInput(watermark??new Date(Date.now()-30*86400000))} disabled={active?'A run is in progress.':null}/>
  </div></section>
  <section className="card"><div className="card-head"><h2>Training runs</h2></div><div className="card-body tight">
   {!runs.length?<EmptyState title="No training runs yet" description="Run the agent above, or wait for the Monday run."/>:<div className="tblwrap"><table>
    <thead><tr><th>Reports assessed</th><th>Started</th><th>Trigger</th><th className="num">Sessions</th><th className="num">Suggestions</th><th>Status</th><th>Reviewed</th></tr></thead>
    <tbody>{runs.map(r=><tr key={r.id}>
     <td><Link href={`/ops/ai-training/${r.id}`}>{when(r.period_from)} → {fmtDateTime(r.period_to)}</Link></td>
     <td>{fmtDateTime(r.created_at)}<div className="muted small">{r.created_by}</div></td>
     <td>{r.trigger==='weekly'?'Weekly':'Manual'}</td>
     <td className="num">{r.session_ids.length}{r.tester_notes?<div className="muted small">+ tester notes</div>:null}</td>
     <td className="num">{r.status==='analysing'?'—':<>{r.suggestions}{r.suggestions>0&&<div className="muted small">{r.accepted} accepted · {r.rejected} rejected</div>}</>}</td>
     <td><Pill tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Pill></td>
     <td>{r.approved_at?<>{fmtDateTime(r.approved_at)}<div className="muted small">{r.reviewed_by}</div></>:'—'}</td>
    </tr>)}</tbody>
   </table></div>}
  </div></section>
 </main>;
}
