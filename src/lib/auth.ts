import {cookies} from 'next/headers';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {sql} from './db';
export type Identity={id:string;role:'ADMIN'|'OPERATIONS'|'FINANCE'|'EMPLOYER'|'PARTNER'|'CANDIDATE'|'REGISTRATION';expires:number};
const secret=()=>process.env.DEMO_SESSION_SECRET||process.env.DEMO_PASSWORD||(process.env.NODE_ENV!=='production'?'local-demo-only-secret': '');
function sign(body:string){const key=secret();if(!key)throw new Error('Set DEMO_SESSION_SECRET and DEMO_PASSWORD before sharing this demo.');return createHmac('sha256',key).update(body).digest('base64url');}
export async function identity(name='nd_identity'):Promise<Identity|null>{
 const token=(await cookies()).get(name)?.value;if(!token)return null;
 try{const [body,sig]=token.split('.');const expected=sign(body);if(!sig||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 const value=JSON.parse(Buffer.from(body,'base64url').toString());return value.expires>Date.now()?value:null;}catch{return null;}
}
export async function setIdentity(id:string,role:Identity['role'],name='nd_identity'){
 const body=Buffer.from(JSON.stringify({id,role,expires:Date.now()+8*3600000})).toString('base64url');
 (await cookies()).set(name,body+'.'+sign(body),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:8*3600});
}
export async function requireRole(roles:Identity['role'][]){const actor=await identity();if(!actor||!roles.includes(actor.role))throw new Error('This action is not available for the selected demo identity. Open Demo identities to sign in or switch.');if(actor.role==='CANDIDATE'){const [c]=await sql`SELECT status FROM app.candidate WHERE id=${actor.id}`;if(!c||c.status==='DELETED_BLOCKED')throw new Error('This profile is no longer active.');}return actor;}
export async function scopePage(section:string,id?:string){
 const roles:Record<string,Identity['role'][]>= {ops:['ADMIN','OPERATIONS'],finance:['ADMIN','FINANCE'],employer:['ADMIN','EMPLOYER'],partner:['ADMIN','PARTNER'],wa:['ADMIN','CANDIDATE']};
 const actor=await requireRole(roles[section]||['ADMIN']);
 if(id&&actor.role!=='ADMIN'&&actor.id!==id)throw new Error('This record belongs to another account.');return actor;
}
export async function authorizeAction(name:string,args:unknown[]){
 if(['actWaStart','actWaVerify','actWaAssessment','actWaProfile'].includes(name))throw new Error('Use the verified candidate journey at /wa.');
 const actor=await identity();if(!actor)throw new Error('Choose a demo identity first.');if(actor.role==='CANDIDATE')await requireRole(['CANDIDATE']);
 if(actor.role==='ADMIN')return;
 const allowed:Record<string,string[]>={
 OPERATIONS:['ApproveEmployer','SuspendEmployer','ApproveJob','RotateQr','SetPartnerStatus','ResolveAttribution','DecideReplacement','CreateEmployer','CreatePartner','ResolveDataRequest','DispatchAlerts','RecomputeMatches'],
 FINANCE:['ReleaseHolds','BuildBatch','ApprovePayout'],
 EMPLOYER:['Unlock','RecordOutcome','RaiseReplacement','BuyCredits','CreateJob','CreateLocation','ProposeInterview','RescheduleInterview','InterviewOutcome','MakeOffer','ReviewDocument','MarkJoined','EditJob','SetJobState','DuplicateJob'],
 PARTNER:['SendNudge','AcceptConduct'],
 CANDIDATE:['WaProfile','WaAssessment','WaApply','WaWithdraw','WaEndorse','RespondToAlert','RespondInterview','RespondOffer','UploadDocument','CreateEndorsementInvite','HideEndorsement','UpdatePreferences','RaiseDataRequest','ConfirmInterest','SaveConsents','StartAssessment','SaveAttributes','AddAchievement','CorrectSource'],
 REGISTRATION:['WaVerify']};
 if(!(allowed[actor.role]||[]).some(s=>'act'+s===name))throw new Error('Not permitted for this role.');
 if(['OPERATIONS','FINANCE'].includes(actor.role))return;
 let id=typeof args[0]==='string'?args[0]:String((args[0] as any)?.applicationId||(args[0] as any)?.employerId||'');
 if(!id)throw new Error('Record identifier required.');
 if(id===actor.id)return;
 const queries:Record<string,string>={
 JOB:actor.role==='EMPLOYER'?'SELECT 1 FROM app.job WHERE id=$1 AND employer_id=$2':'SELECT 1 WHERE false',
 APP:actor.role==='EMPLOYER'?'SELECT 1 FROM app.application a JOIN app.job j ON j.id=a.job_id WHERE a.id=$1 AND j.employer_id=$2':'SELECT 1 FROM app.application WHERE id=$1 AND candidate_id=$2',
 UNL:'SELECT 1 FROM app.qualified_lead_unlock WHERE id=$1 AND employer_id=$2',
 ITV:actor.role==='EMPLOYER'?'SELECT 1 FROM app.interview i JOIN app.application a ON a.id=i.application_id JOIN app.job j ON j.id=a.job_id WHERE i.id=$1 AND j.employer_id=$2':'SELECT 1 FROM app.interview i JOIN app.application a ON a.id=i.application_id WHERE i.id=$1 AND a.candidate_id=$2',
 ONB:actor.role==='EMPLOYER'?'SELECT 1 FROM app.onboarding_case o JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id WHERE o.id=$1 AND j.employer_id=$2':'SELECT 1 FROM app.onboarding_case o JOIN app.application a ON a.id=o.application_id WHERE o.id=$1 AND a.candidate_id=$2',
 DOC:actor.role==='EMPLOYER'?'SELECT 1 FROM app.candidate_document d JOIN app.onboarding_case o ON o.id=d.onboarding_case_id JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id WHERE d.id=$1 AND j.employer_id=$2':'SELECT 1 FROM app.candidate_document WHERE id=$1 AND candidate_id=$2',
 END:'SELECT 1 FROM app.endorsement WHERE id=$1 AND candidate_id=$2',ALR:'SELECT 1 FROM app.job_alert WHERE id=$1 AND candidate_id=$2'};
 const query=queries[id.split('-')[0]];if(!query||!(await sql.unsafe(query,[id,actor.id])).length)throw new Error('Record outside your account.');
}
export async function auditAction(action:string,args:unknown[]){const actor=await identity();if(!actor)return;const id=typeof args[0]==='string'&&/^[A-Z]+-[A-Za-z0-9_-]+$/.test(args[0])?args[0]:null;await sql`INSERT INTO app.action_audit(actor,role,action,entity_id) VALUES(${actor.id},${actor.role},${action},${id})`;}
