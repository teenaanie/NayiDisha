'use server';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireRole} from '@/lib/auth';
import {requestActor} from '@/modules/roleplay/service/auth';
import {ApiError} from '@/modules/roleplay/service/context';
import {startSimRun,advanceSimRun,cancelSimRun,trainSimRun} from '@/modules/roleplay/service/simulation';

async function operator(){
 await requireRole(['ADMIN','OPERATIONS']);
 const actor=await requestActor();
 if(!actor)throw new ApiError(401,'UNAUTHENTICATED','Sign in again.');
 return actor;
}
const message=(e:unknown)=>e instanceof ApiError?e.message:'Something went wrong. Try again.';

export async function startSimAction(_:unknown,form:FormData):Promise<{error?:string}>{
 let id:string;
 try{
  const actor=await operator();
  const levels=form.getAll('levels').map(String);
  const r=await startSimRun(actor,actor.tenant_id,{
   levels:levels as never,practice_sessions:Number(form.get('practice_sessions')),message_budget:Number(form.get('message_budget')),
   assessment:form.get('assessment')==='on',learn:form.get('learn')==='on',train_after:form.get('train_after')==='on',language:String(form.get('language')??'en') as never,
  });
  id=r.id;
  after(()=>advanceSimRun(id,200000).then(()=>undefined).catch(()=>{}));
 }catch(e){return {error:message(e)};}
 redirect(`/ops/simulated-candidates/${id}`);
}

/** One stretch of work (a few minutes at most); the run page calls this until the run is done. */
export async function advanceSimAction(runId:string):Promise<{progressed:boolean;error?:string}>{
 try{await operator();return {progressed:await advanceSimRun(runId,200000)};}
 catch(e){return {progressed:false,error:message(e)};}
}

export async function cancelSimAction(runId:string,_:unknown):Promise<{error?:string}>{
 try{const actor=await operator();await cancelSimRun(actor,runId);}
 catch(e){return {error:message(e)};}
 revalidatePath(`/ops/simulated-candidates/${runId}`);
 return {};
}

/** Run the AI training agent on this simulation's conversations (again, or for the first time). */
export async function trainSimAction(runId:string,_:unknown):Promise<{error?:string}>{
 let id:string;
 try{const actor=await operator();id=(await trainSimRun(actor,runId)).id;}
 catch(e){return {error:message(e)};}
 redirect(`/ops/ai-training/${id}`);
}
