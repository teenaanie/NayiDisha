 'use server';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {sql} from '@/lib/db';
import {readQuery} from '@/lib/read-query';
import {setIdentity,requireRole} from '@/lib/auth';
import {hashPassword,checkPassword,tokenHash} from '@/lib/demo-password';
import {randomBytes} from 'node:crypto';
const val=(f:FormData,k:string)=>String(f.get(k)||'').trim();
async function personalSession(id:string,role:'EMPLOYER'|'PARTNER'|'CANDIDATE',version?:number){
 (await cookies()).delete('nd_admin');await setIdentity(id,role,'nd_identity',version);
}
export async function issueInvitation(role:string,id:string){
 const actor=await requireRole(['ADMIN','OPERATIONS']);
 if(!['EMPLOYER','PARTNER'].includes(role))throw new Error('Invalid account type.');
 const token=randomBytes(32).toString('base64url');
 await sql.begin(async tx=>{
 const rows=role==='EMPLOYER'?await tx`SELECT status FROM app.employer_organisation WHERE id=${id}`:await tx`SELECT status FROM app.partner WHERE id=${id}`;
 if(rows[0]?.status!=='VERIFIED')throw new Error('Approve this organisation before creating its invitation.');
 await tx`INSERT INTO app.demo_account(entity_id,role,invite_hash,invite_expires_at) VALUES(${id},${role},${tokenHash(token)},CURRENT_TIMESTAMP+interval '24 hours') ON CONFLICT(entity_id) DO UPDATE SET invite_hash=EXCLUDED.invite_hash,invite_expires_at=EXCLUDED.invite_expires_at`;
 await tx`INSERT INTO app.action_audit(actor,role,action,entity_id) VALUES(${actor.id},${actor.role},'DEMO_INVITATION_CREATED',${id})`;
 });return '/invite/'+token;
}
export async function acceptInvitation(f:FormData){
 const token=val(f,'token');let account:any;
 try{
 const hash=await hashPassword(String(f.get('password')||''));
 account=await sql.begin(async tx=>{
 const [a]=await tx`SELECT * FROM app.demo_account WHERE invite_hash=${tokenHash(token)} AND invite_expires_at>CURRENT_TIMESTAMP FOR UPDATE`;
 if(!a)throw new Error('This invitation has expired or was already used. Ask Operations for a new one.');
 const rows=a.role==='EMPLOYER'?await tx`SELECT status FROM app.employer_organisation WHERE id=${a.entity_id} FOR UPDATE`:await tx`SELECT status FROM app.partner WHERE id=${a.entity_id} FOR UPDATE`;
 if(rows[0]?.status!=='VERIFIED')throw new Error('This organisation is not approved for access.');
 await tx`UPDATE app.demo_account SET password_hash=${hash},invite_hash=NULL,invite_expires_at=NULL,activated_at=CURRENT_TIMESTAMP,failed_attempts=0,locked_until=NULL,version=version+1 WHERE entity_id=${a.entity_id}`;
 await tx`INSERT INTO app.action_audit(actor,role,action,entity_id) VALUES(${a.entity_id},${a.role},'DEMO_INVITATION_ACCEPTED',${a.entity_id})`;
 return {...a,version:a.version+1};
 });
 }catch(e){return {error:e instanceof Error?e.message:'Unable to accept invitation.'};}
 await personalSession(account.entity_id,account.role,account.version);
 redirect(account.role==='EMPLOYER'?'/employer':'/partner');
}
export async function signIn(f:FormData){
 let account:any;
 try{
 const id=val(f,'id');const password=String(f.get('password')||'');
 account=await sql.begin(async tx=>{
 const [a]=await tx`SELECT * FROM app.demo_account WHERE entity_id=${id} FOR UPDATE`;
 if(!a?.password_hash||a.locked_until&&new Date(a.locked_until)>new Date())return null;
 if(!await checkPassword(password,a.password_hash)){
 await tx`UPDATE app.demo_account SET failed_attempts=CASE WHEN locked_until IS NOT NULL THEN 1 ELSE failed_attempts+1 END,locked_until=CASE WHEN locked_until IS NULL AND failed_attempts>=4 THEN CURRENT_TIMESTAMP+interval '15 minutes' ELSE NULL END WHERE entity_id=${id}`;return null;
 }
 const rows=a.role==='EMPLOYER'?await tx`SELECT status FROM app.employer_organisation WHERE id=${id}`:await tx`SELECT status FROM app.partner WHERE id=${id}`;
 if(rows[0]?.status!=='VERIFIED')return null;
 await tx`UPDATE app.demo_account SET failed_attempts=0,locked_until=NULL WHERE entity_id=${id}`;
 return a;
 });
 }catch{return {error:'Sign-in is unavailable. Please try again.'};}
 if(!account)return {error:'Unable to sign in. Check your account ID and password. After repeated attempts, wait 15 minutes. Contact Operations if access needs resetting.'};
 await personalSession(account.entity_id,account.role,account.version);redirect(account.role==='EMPLOYER'?'/employer':'/partner');
}
export async function candidateSignIn(f:FormData){
 const phone=val(f,'phone');
 if(!/^\+910000[0-9]{6}$/.test(phone)||val(f,'code')!=='123456')return {error:'Use your original demo mobile number and simulated code 123456.'};
 let candidate:any;
 try{[candidate]=await readQuery(sql`SELECT id FROM app.candidate WHERE phone=${phone} AND mobile_verified_at IS NOT NULL AND status<>'DELETED_BLOCKED'`);}catch{return {error:'Could not load your profile. Try again.'};}
 if(!candidate)return {error:'No verified demo profile found. Start a new candidate journey below.'};
 await personalSession(candidate.id,'CANDIDATE');redirect('/wa/profile');
}
export async function signOut(){const c=await cookies();c.delete('nd_identity');c.delete('nd_admin');redirect('/sign-in');}
