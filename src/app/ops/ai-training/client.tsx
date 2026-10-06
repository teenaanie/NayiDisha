'use client';
import {useActionState,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {startRunAction,advanceRunAction,reviewSuggestionAction,approveRunAction,retryRunAction} from './actions';

export function StartRunForm({from,disabled}:{from:string;disabled:string|null}){
 const [state,action,pending]=useActionState(startRunAction,{});
 return <form action={action}>
  <div className="field"><label htmlFor="tr-notes">Tester notes (optional, one observation per line)</label>
   <textarea id="tr-notes" name="notes" rows={5} placeholder={'First answer said son rather than daughter.\nWhen asked about her expenses it said I do not have any other details right now.'}/>
   <div className="muted small">The agent checks each note against the transcripts and folds it into the report.</div></div>
  <div className="field" style={{maxWidth:280}}><label htmlFor="tr-from">Review reports assessed after</label>
   <input id="tr-from" name="from" type="datetime-local" defaultValue={from}/>
   <div className="muted small">Defaults to where the last run ended.</div></div>
  {state.error&&<div className="note bad mb">{state.error}</div>}
  <div className="btnrow"><button className="btn btn-primary" disabled={pending||!!disabled}>{pending?'Starting…':'Run the training agent'}</button>{disabled&&<span className="muted small">{disabled}</span>}</div>
 </form>;
}

/** While a run is analysing, keep asking the server to do the next unit of work, then refresh. */
export function RunProgress({runId}:{runId:string}){
 const router=useRouter();const [error,setError]=useState<string|null>(null);const alive=useRef(true);
 useEffect(()=>{
  alive.current=true;
  (async()=>{
   while(alive.current){
    const r=await advanceRunAction(runId).catch(()=>({progressed:false,error:'Lost connection; retrying.'}));
    if(!alive.current)break;
    setError(r.error??null);router.refresh();
    // Busy elsewhere (another tab, the cron) or between units: wait a little before asking again.
    await new Promise(res=>setTimeout(res,r.progressed?1000:5000));
   }
  })();
  return ()=>{alive.current=false;};
 },[runId,router]);
 return <div className="note mb"><strong>Analysing.</strong> Gemini Pro reviews five sessions at a time (usually under a minute each). Keep this page open to keep it moving; otherwise the daily schedule finishes it.{error&&<div className="muted small">{error}</div>}</div>;
}

type Suggestion={id:string;status:'pending'|'accepted'|'rejected';proposed_change:string;edited_change:string|null;reviewer_note:string|null};
/**
 * React resets a form after its action runs; keyed on the saved decision, the form is rebuilt
 * from the saved values instead of falling back to blank defaults.
 */
export function SuggestionReview(props:{runId:string;s:Suggestion;open:boolean}){
 if(!props.open)return null;
 const {s}=props;
 return <ReviewForm key={`${s.status}|${s.edited_change??''}|${s.reviewer_note??''}`} {...props}/>;
}

function ReviewForm({runId,s}:{runId:string;s:Suggestion}){
 const [state,action,pending]=useActionState(reviewSuggestionAction.bind(null,runId,s.id),{});
 const [status,setStatus]=useState(s.status);
 return <form action={action} className="mt">
  <fieldset className="field-group"><legend>Decision</legend>
   {(['accepted','rejected','pending'] as const).map(v=><label key={v}><input type="radio" name="status" value={v} defaultChecked={s.status===v} onChange={()=>setStatus(v)}/>{v==='accepted'?'Accept':v==='rejected'?'Reject':'Undecided'}</label>)}
  </fieldset>
  {status==='accepted'&&<div className="field"><label htmlFor={`ch-${s.id}`}>Change to build (edit if needed)</label><textarea id={`ch-${s.id}`} name="edited_change" rows={4} defaultValue={s.edited_change??s.proposed_change}/></div>}
  <div className="field"><label htmlFor={`rn-${s.id}`}>Reviewer note (optional)</label><input id={`rn-${s.id}`} name="reviewer_note" defaultValue={s.reviewer_note??''}/></div>
  <div className="btnrow"><button className="btn btn-sm btn-primary" disabled={pending}>{pending?'Saving…':'Save decision'}</button>{state.saved&&!pending&&<span className="muted small">Saved</span>}{state.error&&<span className="small" style={{color:'var(--bad)'}}>{state.error}</span>}</div>
 </form>;
}

export function ApproveButton({runId,pending:waiting}:{runId:string;pending:number}){
 const [state,action,pending]=useActionState(approveRunAction.bind(null,runId),{});
 return <form action={action} className="btnrow">
  <button className="btn btn-primary" disabled={pending||waiting>0}>{pending?'Approving…':'Approve review and create build brief'}</button>
  {waiting>0&&<span className="muted small">{waiting} suggestion{waiting===1?'':'s'} still need a decision.</span>}
  {state.error&&<span className="small" style={{color:'var(--bad)'}}>{state.error}</span>}
 </form>;
}

export function RetryButton({runId}:{runId:string}){
 const [state,action,pending]=useActionState(retryRunAction.bind(null,runId),{});
 return <form action={action} className="btnrow"><button className="btn btn-sm" disabled={pending}>{pending?'Retrying…':'Retry this run'}</button>{state.error&&<span className="small" style={{color:'var(--bad)'}}>{state.error}</span>}</form>;
}

export function BriefActions({md,filename}:{md:string;filename:string}){
 const [copied,setCopied]=useState(false);
 const copy=async()=>{try{await navigator.clipboard.writeText(md);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setCopied(false);}};
 const download=()=>{const url=URL.createObjectURL(new Blob([md],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);};
 return <div className="btnrow mb"><button type="button" className="btn btn-sm btn-primary" onClick={copy}>{copied?'Copied':'Copy brief'}</button><button type="button" className="btn btn-sm" onClick={download}>Download .md</button></div>;
}
