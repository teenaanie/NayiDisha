 'use client';
import {useState,useTransition} from 'react';
import {signIn,candidateSignIn,acceptInvitation} from './actions';
export function AccessForm({kind,token}:{kind:'organisation'|'candidate'|'invite';token?:string}){
 const [pending,start]=useTransition();const [error,setError]=useState('');
 const action=kind==='invite'?acceptInvitation:kind==='candidate'?candidateSignIn:signIn;
 return <form action={f=>start(async()=>{setError('');try{const result=await action(f);if(result)setError(result.error);}catch{setError('Unable to complete this request. Please try again.');}})}>
 {kind==='organisation'&&<label className="field">Account ID<input name="id" required autoComplete="username" placeholder="Your employer or partner ID"/></label>}
 {kind==='invite'&&<input type="hidden" name="token" value={token}/>}
 {kind==='candidate'?<><label className="field">Registered demo mobile number<input name="phone" required placeholder="+910000000042" autoComplete="tel"/></label><label className="field">Simulated verification code<input name="code" required pattern="123456" inputMode="numeric"/></label><p>Demo only: enter 123456. No SMS or WhatsApp message is sent.</p></>:<label className="field">{kind==='invite'?'Choose a demo password':'Demo password'}<input name="password" type="password" required minLength={10} maxLength={128} autoComplete={kind==='invite'?'new-password':'current-password'}/></label>}
 <button className="btn btn-primary" disabled={pending}>{pending?'Opening your account…':kind==='invite'?'Accept invitation & open dashboard':'Sign in'}</button><p role="status">{error}</p>
 </form>;
}
