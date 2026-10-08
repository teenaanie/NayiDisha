'use client';
import {useActionState,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {startSimAction,advanceSimAction,cancelSimAction,trainSimAction} from './actions';

type Level={id:string;label:string;expected:string};
export function StartSimForm({levels,disabled}:{levels:Level[];disabled:string|null}){
 const [state,action,pending]=useActionState(startSimAction,{});
 return <form action={action}>
  <fieldset className="field-group"><legend>Candidates</legend>
   {levels.map(l=><label key={l.id}><input type="checkbox" name="levels" value={l.id} defaultChecked/>{l.label} <span className="muted small">(expected {l.expected})</span></label>)}
  </fieldset>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
   <div className="field"><label htmlFor="sim-n">Practice sessions per candidate</label><input id="sim-n" name="practice_sessions" type="number" min={1} max={10} defaultValue={5}/></div>
   <div className="field"><label htmlFor="sim-m">Messages per session</label><input id="sim-m" name="message_budget" type="number" min={4} max={30} defaultValue={14}/><div className="muted small">About 14 is a 10-minute conversation.</div></div>
   <div className="field"><label htmlFor="sim-l">Language</label><select id="sim-l" name="language" defaultValue="en"><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></select></div>
  </div>
  <fieldset className="field-group"><legend>Options</legend>
   <label><input type="checkbox" name="assessment" defaultChecked/>Finish with the graded assessment</label>
   <label><input type="checkbox" name="learn" defaultChecked/>Candidates read their last report's coaching before each session</label>
   <label><input type="checkbox" name="train_after" defaultChecked/>Run the AI training agent when done</label>
  </fieldset>
  {state.error&&<div className="note bad mb">{state.error}</div>}
  <div className="btnrow"><button className="btn btn-primary" disabled={pending||!!disabled}>{pending?'Starting…':'Run the simulation'}</button>{disabled&&<span className="muted small">{disabled}</span>}</div>
 </form>;
}

/** While a run is going, keep asking the server to do the next stretch of work, then refresh. */
export function SimProgress({runId}:{runId:string}){
 const router=useRouter();const [error,setError]=useState<string|null>(null);const alive=useRef(true);
 useEffect(()=>{
  alive.current=true;
  const tick=setInterval(()=>router.refresh(),8000);
  (async()=>{
   while(alive.current){
    const r=await advanceSimAction(runId).catch(()=>({progressed:false,error:'Lost connection; retrying.'}));
    if(!alive.current)break;
    setError(r.error??null);router.refresh();
    await new Promise(res=>setTimeout(res,r.progressed?1000:6000));
   }
  })();
  return ()=>{alive.current=false;clearInterval(tick);};
 },[runId,router]);
 return <div className="note mb"><strong>Running.</strong> The candidates are practising now; this page updates as they go. Keep it open to keep it moving (a full run takes about 10–15 minutes); otherwise the daily schedule finishes it.{error&&<div className="muted small">{error}</div>}</div>;
}

export function CancelSim({runId}:{runId:string}){
 const [state,action,pending]=useActionState(cancelSimAction.bind(null,runId),{});
 return <form action={action} className="btnrow"><button className="btn btn-sm" disabled={pending}>{pending?'Cancelling…':'Cancel run'}</button>{state.error&&<span className="small" style={{color:'var(--bad)'}}>{state.error}</span>}</form>;
}

export function TrainSim({runId,again}:{runId:string;again:boolean}){
 const [state,action,pending]=useActionState(trainSimAction.bind(null,runId),{});
 return <form action={action} className="btnrow"><button className="btn btn-sm" disabled={pending}>{pending?'Starting…':again?'Run the AI training agent again on these conversations':'Run the AI training agent on these conversations'}</button>{state.error&&<span className="small" style={{color:'var(--bad)'}}>{state.error}</span>}</form>;
}
