import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../../ui';
import {requestActor} from '@/modules/roleplay/service/auth';
import {ApiError} from '@/modules/roleplay/service/context';
import {getSimRun,judgedScore} from '@/modules/roleplay/service/simulation';
import {simPersonality} from '@/modules/roleplay/simulation/levels';
import {SimProgress,CancelSim,TrainSim} from '../client';
import {SIM_STATUS,STEP_STATUS} from '../labels';
export const dynamic='force-dynamic';
// The page's server action runs a few minutes of the simulation per call.
export const maxDuration=300;

const pct=(v:string|number|null)=>v==null?'—':String(Math.round(Number(v)));

export default async function SimRun({params}:{params:Promise<{id:string}>}){
 await scopePage('ops');
 const {id}=await params;
 const actor=await requestActor();
 if(!actor)return <main className="page"><div className="note bad">Sign in again to view this simulation.</div></main>;
 let data;
 try{data=await getSimRun(actor,id);}catch(e){
  if(e instanceof ApiError)return <main className="page"><div className="note bad">{e.message}</div><p><Link href="/ops/simulated-candidates">Back to simulated candidates</Link></p></main>;
  throw e;
 }
 const {run,sessions,calibration,comparison,levels}=data;
 const done=sessions.filter(s=>s.status==='done').length;
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker"><Link href="/ops/simulated-candidates">Simulated candidates</Link></div>
   <h1>Simulation <Pill tone={SIM_STATUS[run.status].tone}>{SIM_STATUS[run.status].label}</Pill></h1>
   <p>Started {fmtDateTime(run.created_at)} by {run.created_by} · {run.config.practice_sessions} practice{run.config.practice_sessions===1?'':'s'} per candidate{run.config.assessment?' + graded assessment':''} · {run.config.message_budget} messages each · {run.config.learn?'learning from coaching':'fixed behaviour'} · {run.config.language==='en'?'English':run.config.language==='hi'?'Hindi':'Marathi'} · {done} of {sessions.length} sessions done</p></div>

  {run.status==='running'&&<><SimProgress runId={run.id}/><div className="mb"><CancelSim runId={run.id}/></div></>}
  {run.error&&<div className={`note ${run.status==='failed'?'bad':''} mb`}>{run.error}</div>}

  <section className="card mb"><div className="card-head"><h2>Calibration</h2><span className="small muted">Does each candidate score in the band its level should get?</span></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>Candidate</th><th>Expected</th><th>Practice scores</th><th className="num">Assessment</th><th>Result</th><th>Compared with the previous run</th></tr></thead>
   <tbody>{calibration.map(c=><tr key={c.level}>
    <td><strong>{c.label}</strong></td><td className="small">{c.expected}</td>
    <td style={{fontVariantNumeric:'tabular-nums'}}>{c.practice.map(pct).join(' → ')||'—'}</td>
    <td className="num">{c.assessment?<>{pct(c.assessment.percent)} <span className="muted small">{c.assessment.band??''}</span></>:'—'}</td>
    <td>{c.in_band==null?<span className="muted">waiting</span>:<Pill tone={c.in_band?'ok':'warn'}>{c.in_band?'In band':'Outside band'}</Pill>}{c.judged_on&&<div className="muted small">judged on the {c.judged_on}</div>}</td>
    <td>{(()=>{const p=comparison[c.level];if(!p)return <span className="muted small">no earlier run</span>;
     const ch=p.change;
     return <><span style={{fontVariantNumeric:'tabular-nums'}}>{pct(p.percent)} → {pct(judgedScore(c))}</span>{ch!=null&&<> <Pill tone={ch>0?'ok':ch<0?'warn':'mute'}>{ch>0?`+${ch}`:ch===0?'no change':ch}</Pill></>}
      <div className="muted small"><Link href={`/ops/simulated-candidates/${p.run_id}`}>run of {fmtDateTime(p.created_at)}</Link>{p.judged_on&&p.judged_on!==c.judged_on?` · that run was judged on its ${p.judged_on}`:''}</div></>;})()}</td>
   </tr>)}</tbody>
  </table></div></div></section>

  {run.training_run_id&&<div className="note mb">The AI training agent reviewed these sessions: <Link href={`/ops/ai-training/${run.training_run_id}`}>open the training run</Link>.</div>}
  {run.status!=='running'&&done>0&&<div className="mb"><TrainSim runId={run.id} again={!!run.training_run_id}/></div>}

  {levels.map(l=>{const mine=sessions.filter(s=>s.level===l.id);return <section key={l.id} className="card mb"><div className="card-head"><h2>{l.label}</h2><span className="small muted">Expected {l.expected_band.label} ({l.expected_band.min}–{l.expected_band.max})</span></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>#</th><th>Session</th><th>Personality</th><th>Status</th><th className="num">Messages</th><th className="num">Score</th><th>Coaching it used</th></tr></thead>
   <tbody>{mine.map(s=><tr key={s.id}>
    <td>{s.seq}</td>
    <td>{s.kind==='assessment'?'Graded assessment':'Practice'}{s.session_id&&<div className="small"><Link href={`/roleplay/s/${s.session_id}/report`}>Report and transcript</Link></div>}</td>
    <td className="small">{simPersonality(s.personality)?.label??'—'}</td>
    <td><Pill tone={STEP_STATUS[s.status].tone}>{STEP_STATUS[s.status].label}</Pill>{s.error&&<div className="small" style={{color:'var(--bad)'}}>{s.error}</div>}</td>
    <td className="num">{s.messages}</td>
    <td className="num">{s.final_percent!=null?<>{pct(s.final_percent)} <span className="muted small">{s.band_label}</span></>:'—'}</td>
    <td className="small">{s.coach_notes?.length?<details><summary>{s.coach_notes.length} note{s.coach_notes.length===1?'':'s'}</summary><ul>{s.coach_notes.map((n,i)=><li key={i}>{n}</li>)}</ul></details>:<span className="muted">{s.seq===1?'first session':'—'}</span>}</td>
   </tr>)}</tbody>
  </table></div></div></section>;})}
 </main>;
}
