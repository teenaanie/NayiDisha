'use client';
import {useState,useTransition} from 'react';
import {inviteCandidates} from './actions';
type Result={phone:string;status:string;token?:string};
const LABEL:Record<string,string>={SENT:'Invitation sent',ALREADY_REGISTERED:'Already registered',INVALID:'Not a demo number'};
export function InviteForm(){
 const [pending,start]=useTransition();const [results,setResults]=useState<Result[]>([]);const [error,setError]=useState('');
 return <form className="nd-workflow-form" action={f=>start(async()=>{setError('');const r=await inviteCandidates(String(f.get('phones')||''),String(f.get('language')||'en'));if(r.error)setError(r.error);setResults(r.results);})}>
  <label>Demo mobile numbers (one per line)<textarea name="phones" rows={4} placeholder={'+910000000101\n+910000000102'} required/></label>
  <label>Message language<select name="language" defaultValue="en"><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></label>
  <button className="btn btn-primary" disabled={pending}>{pending?'Sending…':'Send WhatsApp invitation'}</button>
  <p role="status">{error}</p>
  {results.length>0&&<ul className="small">{results.map(r=><li key={r.phone}>{r.phone}: {LABEL[r.status]||r.status}{r.token&&<> · <a href={'/wa/invite/'+r.token} target="_blank" rel="noreferrer">open their WhatsApp</a></>}</li>)}</ul>}
 </form>;
}
