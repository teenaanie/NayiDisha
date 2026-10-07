'use client';
import {useActionState} from 'react';
import {setAttemptsAction} from './actions';

/** Attempts allowed for one candidate and scenario; cannot go below the attempts already used. */
export function AttemptsForm({learnerId,scenarioId,used,allowed,max}:{learnerId:string;scenarioId:string;used:number;allowed:number;max:number}){
 const [state,action,pending]=useActionState(setAttemptsAction.bind(null,learnerId,scenarioId),{});
 const id=`att-${learnerId}-${scenarioId}`;
 return <form action={action} key={allowed} style={{minWidth:200}}>
  <div className="btnrow" style={{alignItems:'center',gap:6}}>
   <label htmlFor={id} className="small">Allowed</label>
   <input id={id} name="attempts" type="number" min={Math.max(used,1)} max={max} defaultValue={allowed} required style={{width:64}}/>
   <button className="btn btn-sm" disabled={pending}>{pending?'Saving…':'Save'}</button>
  </div>
  <input name="reason" aria-label="Reason (optional)" placeholder="Reason (optional)" maxLength={500} className="mt" style={{width:'100%'}}/>
  {state.error&&<div className="small" style={{color:'var(--bad)'}}>{state.error}</div>}
  {state.saved&&!pending&&<div className="small muted">{state.saved}</div>}
 </form>;
}
