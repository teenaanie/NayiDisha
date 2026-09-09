 'use client';
import {useState,useTransition} from 'react';
import {manage} from './actions';
export function ManagedForm({children,kind,id}:{children:React.ReactNode;kind:string;id?:string}){
 const [pending,start]=useTransition(),[message,setMessage]=useState('');
 return <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);start(async()=>{try{await manage(data);setMessage('Saved.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to save.');}});}}>
 <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={id||''}/>{children}<div className="field"><label>Reason / note<input name="reason" placeholder="Why this change is needed"/></label></div><button className="btn btn-primary" disabled={pending}>{pending?'Saving…':'Save'}</button><p role="status">{message}</p></form>;
}
