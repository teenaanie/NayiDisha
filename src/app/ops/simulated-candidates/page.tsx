import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../ui';
import {EmptyState} from '../../workspace-components';
import {requestActor} from '@/modules/roleplay/service/auth';
import {listSimRuns} from '@/modules/roleplay/service/simulation';
import {SIM_LEVELS} from '@/modules/roleplay/simulation/levels';
import {StartSimForm} from './client';
import {SIM_STATUS} from './labels';
export const dynamic='force-dynamic';
// Starting a run also begins its first stretch of work.
export const maxDuration=300;

/**
 * Simulated candidates: AI learners at three levels practise with the AI customer through the
 * real product, take the graded assessment, and are reviewed by the AI training agent.
 */
export default async function SimulatedCandidates(){
 await scopePage('ops');
 const actor=await requestActor();
 if(!actor)return <main className="page"><div className="note bad">Sign in again to run simulated candidates.</div></main>;
 const runs=await listSimRuns(actor);
 const active=runs.find(r=>r.status==='running');
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Practice coach</div><h1>Simulated candidates</h1>
   <p>Three AI candidates (needs improvement, competent and excellent) practise with the AI customer through the real product, as learners in their own "Simulated candidates" team. Each practice is assessed and coached as usual; before the next one, the candidate reads its coaching and tries to apply it as its level would. They finish with the graded assessment. The run then checks that each score lands in the band its level should get, and hands the sessions to the AI training agent.</p></div>
  <section className="card mb"><div className="card-head"><h2>Run a simulation</h2><span className="small muted">Default run: 3 candidates × 5 practices + assessment, about 10–15 minutes and ₹80–100 in AI costs</span></div><div className="card-body">
   <StartSimForm levels={SIM_LEVELS.map(l=>({id:l.id,label:l.label,expected:`${l.expected_band.label}, ${l.expected_band.min}–${l.expected_band.max}`}))} disabled={active?'A simulation is running.':null}/>
  </div></section>
  <section className="card"><div className="card-head"><h2>Simulation runs</h2></div><div className="card-body tight">
   {!runs.length?<EmptyState title="No simulations yet" description="Run one above."/>:<div className="tblwrap"><table>
    <thead><tr><th>Started</th><th>Candidates</th><th className="num">Sessions</th><th>Calibration</th><th>Status</th><th>Training run</th></tr></thead>
    <tbody>{runs.map(r=>{const cal=r.summary??[];const hit=cal.filter(c=>c.in_band).length;return <tr key={r.id}>
     <td><Link href={`/ops/simulated-candidates/${r.id}`}>{fmtDateTime(r.created_at)}</Link><div className="muted small">{r.created_by}</div></td>
     <td>{r.config.levels.map(l=>SIM_LEVELS.find(x=>x.id===l)?.label??l).join(', ')}<div className="muted small">{r.config.practice_sessions} practices{r.config.assessment?' + assessment':''} · {r.config.message_budget} messages</div></td>
     <td className="num">{r.done} of {r.sessions}{r.failed>0&&<div className="small" style={{color:'var(--bad)'}}>{r.failed} failed</div>}</td>
     <td>{cal.length?<Pill tone={hit===cal.length?'ok':'warn'}>{hit} of {cal.length} in band</Pill>:'—'}</td>
     <td><Pill tone={SIM_STATUS[r.status].tone}>{SIM_STATUS[r.status].label}</Pill></td>
     <td>{r.training_run_id?<Link href={`/ops/ai-training/${r.training_run_id}`}>Open</Link>:'—'}</td>
    </tr>;})}</tbody>
   </table></div>}
  </div></section>
 </main>;
}
