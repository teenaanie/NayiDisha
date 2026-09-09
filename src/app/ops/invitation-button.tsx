 'use client';
import {useState,useTransition} from 'react';
import {issueInvitation} from '../sign-in/actions';
export function InvitationButton({role,id}:{role:'EMPLOYER'|'PARTNER';id:string}){
 const [pending,start]=useTransition();const [link,setLink]=useState('');const [message,setMessage]=useState('');
 return <div><button className="btn btn-sm" disabled={pending} onClick={()=>start(async()=>{setMessage('');try{setLink(await issueInvitation(role,id));}catch(e){setMessage(e instanceof Error?e.message:'Could not create invitation.');}})}>{pending?'Creating…':'Create / replace invitation'}</button>{link&&<div className="note"><p>Simulated invitation · expires in 24 hours. Replacing this link cancels the previous invitation.</p><a href={link} target="_blank" rel="noreferrer">Open invitation as recipient</a><br/><button className="btn btn-sm" onClick={async()=>{try{await navigator.clipboard.writeText(new URL(link,window.location.origin).href);setMessage('Invitation link copied.');}catch{setMessage('Copy the invitation link using the link above.');}}}>Copy invitation link</button><p>Opening this in the same browser switches your session. Use a private browser window to keep Operations signed in.</p></div>}<p role="status">{message}</p></div>;
}
