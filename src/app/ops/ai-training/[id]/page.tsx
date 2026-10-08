import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../../ui';
import {EmptyState} from '../../../workspace-components';
import {requestActor} from '@/modules/roleplay/service/auth';
import {ApiError} from '@/modules/roleplay/service/context';
import {getTrainingRun,AREA_LABELS,AREA_GROUPS,VERDICT_LABELS,type SuggestionRow} from '@/modules/roleplay/service/training';
import {RunProgress,SuggestionReview,ApproveButton,RetryButton,BriefActions} from '../client';
import {RUN_STATUS,SEVERITY_TONE} from '../labels';
export const dynamic='force-dynamic';
// The page's server actions run one review step each (a Gemini Pro call of up to a few minutes).
export const maxDuration=300;

const VERDICT_TONE:Record<string,'ok'|'warn'|'mute'|'info'>={confirmed:'ok',partly:'warn',not_found:'mute',not_checkable:'info'};

export default async function TrainingRun({params}:{params:Promise<{id:string}>}){
 await scopePage('ops');
 const {id}=await params;
 const actor=await requestActor();
 if(!actor)return <main className="page"><div className="note bad">Sign in again to use the AI training agent.</div></main>;
 let data;
 try{data=await getTrainingRun(actor,id);}catch(e){
  if(e instanceof ApiError)return <main className="page"><div className="note bad">{e.message}</div><p><Link href="/ops/ai-training">Back to AI training</Link></p></main>;
  throw e;
 }
 const {run,suggestions,notes}=data;
 const result=(run.result??{}) as {summary?:string;assessment_summary?:string;tester_note_findings?:{note_index:number;verdict:keyof typeof VERDICT_LABELS;explanation:string}[];dropped?:{evidence:number;suggestions:number}};
 const open=run.status==='in_review';
 const pending=suggestions.filter(s=>s.status==='pending').length;
 const done=run.steps.filter(s=>s.status==='done').length;
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker"><Link href="/ops/ai-training">AI training</Link></div>
   <h1>Training run <Pill tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Pill></h1>
   <p>{run.scope==='sessions'?<>The sessions of one simulation, assessed {fmtDateTime(run.period_from)} to {fmtDateTime(run.period_to)} (weekly runs are not affected) · </>:<>Reports assessed {+run.period_from===0?'from the beginning':`after ${fmtDateTime(run.period_from)}`} up to {fmtDateTime(run.period_to)} · </>}{run.session_ids.length} session{run.session_ids.length===1?'':'s'} · {run.trigger==='weekly'?'weekly schedule':`started by ${run.created_by}`} on {fmtDateTime(run.created_at)}{run.model?` · ${run.model}`:''}</p></div>

  {run.status==='analysing'&&<><RunProgress runId={run.id}/><div className="muted small mb">{done} of {run.steps.length} batch{run.steps.length===1?'':'es'} reviewed{done===run.steps.length?'; combining the results':''}.</div></>}
  {run.status==='failed'&&<div className="note bad mb"><p>{run.error??'The run failed.'}</p><RetryButton runId={run.id}/></div>}
  {run.sessions_skipped>0&&<div className="note mb">This run covers the oldest {run.session_ids.length} sessions in the period; {run.sessions_skipped} newer ones are left for the next run.</div>}

  {result.summary&&<section className="card mb"><div className="card-head"><h2>Summary</h2></div><div className="card-body"><p>{result.summary}</p>
   {!!result.dropped&&(result.dropped.evidence>0||result.dropped.suggestions>0)&&<p className="muted small">Discarded as unverifiable: {result.dropped.evidence} quote{result.dropped.evidence===1?'':'s'} that did not match the transcript, {result.dropped.suggestions} suggestion{result.dropped.suggestions===1?'':'s'} left without evidence.</p>}
  </div></section>}

  {result.assessment_summary&&<section className="card mb"><div className="card-head"><h2>Assessment and coaching review</h2></div><div className="card-body"><p>{result.assessment_summary}</p><p className="muted small">How well the scores, evidence, risk flags, feedback and coaching matched the conversations, and what the assessment framework itself could do better.</p></div></section>}

  {notes.length>0&&<section className="card mb"><div className="card-head"><h2>Tester notes</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>#</th><th>Note</th><th>Finding</th></tr></thead>
   <tbody>{notes.map((n,i)=>{const f=result.tester_note_findings?.find(x=>x.note_index===i);return <tr key={i}><td>{i+1}</td><td>{n}</td><td>{f?<><Pill tone={VERDICT_TONE[f.verdict]}>{VERDICT_LABELS[f.verdict]}</Pill> <span className="small">{f.explanation}</span></>:<span className="muted">{run.status==='analysing'?'Pending':'Not assessed'}</span>}</td></tr>;})}</tbody>
  </table></div></div></section>}

  {run.status!=='analysing'&&<section className="card mb"><div className="card-head"><h2>Suggestions ({suggestions.length})</h2></div><div className="card-body">
   {!suggestions.length?<EmptyState title="No suggestions" description={run.session_ids.length?'The agent found nothing to improve in these sessions.':'There were no sessions to review.'}/>:
    AREA_GROUPS.map(g=>{const items=suggestions.filter(x=>g.areas.includes(x.area));return items.length?<div key={g.title}><h3 className="mb">{g.title} ({items.length})</h3>{items.map((s:SuggestionRow)=><article key={s.id} className="card mb" style={{padding:'12px 14px'}}>
     <div className="btnrow"><strong>{s.seq}. {s.title}</strong></div>
     <div className="tags mt"><Pill tone={SEVERITY_TONE[s.severity]}>{s.severity}</Pill><Pill tone="info">{AREA_LABELS[s.area]}</Pill>{s.occurrences>1&&<Pill>{s.occurrences} times</Pill>}{s.source==='tester_note'&&<Pill tone="ok">tester note {s.tester_note_indexes.map(n=>n+1).join(', ')}</Pill>}
      {s.status!=='pending'&&<Pill tone={s.status==='accepted'?'ok':'mute'}>{s.status}{s.reviewed_by?` by ${s.reviewed_by}`:''}</Pill>}</div>
     <p className="mt">{s.observation}</p>
     {s.evidence.length>0&&<ul className="small">{s.evidence.map((e,i)=><li key={i}><Link href={`/roleplay/s/${e.session_id}/report`}>Session {e.session_id.slice(0,8)}</Link>{e.turn===null?<>, assessment report</>:<>, turn {e.turn} ({e.speaker})</>}: <q>{e.quote}</q></li>)}</ul>}
     <div className="note"><strong>Proposed change:</strong> {s.edited_change??s.proposed_change}{s.edited_change&&<div className="muted small">Edited by the reviewer. The agent proposed: {s.proposed_change}</div>}{s.reviewer_note&&<div className="small"><strong>Reviewer note:</strong> {s.reviewer_note}</div>}</div>
     <SuggestionReview runId={run.id} s={{id:s.id,status:s.status,proposed_change:s.proposed_change,edited_change:s.edited_change,reviewer_note:s.reviewer_note}} open={open}/>
    </article>)}</div>:null;})}
   {open&&<ApproveButton runId={run.id} pending={pending}/>}
  </div></section>}

  {run.brief_md&&<section className="card"><div className="card-head"><h2>Build brief</h2></div><div className="card-body">
   <p className="muted small">Approved by {run.reviewed_by} on {fmtDateTime(run.approved_at)}. Hand this to the developer (or Claude) to build the next version.</p>
   <BriefActions md={run.brief_md} filename={`build-brief-${new Date(run.period_to).toISOString().slice(0,10)}.md`}/>
   <pre style={{whiteSpace:'pre-wrap',fontSize:'.8rem',maxHeight:520,overflow:'auto'}}>{run.brief_md}</pre>
  </div></section>}
 </main>;
}
