'use server';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireRole} from '@/lib/auth';
import {requestActor} from '@/modules/roleplay/service/auth';
import {ApiError} from '@/modules/roleplay/service/context';
import {startTrainingRun,advanceTrainingRun,advanceTrainingRuns,reviewSuggestion,approveTrainingRun,retryTrainingRun} from '@/modules/roleplay/service/training';

/** Operators (ADMIN, OPERATIONS) act as their Practice coach user, which carries the author role. */
async function trainer(){
 await requireRole(['ADMIN','OPERATIONS']);
 const actor=await requestActor();
 if(!actor)throw new ApiError(401,'UNAUTHENTICATED','Sign in again.');
 return actor;
}
const message=(e:unknown)=>e instanceof ApiError?e.message:'Something went wrong. Try again.';

export async function startRunAction(_:unknown,form:FormData):Promise<{error?:string}>{
 let id:string;
 try{
  const actor=await trainer();
  const fromRaw=String(form.get('from')??'').trim();
  // datetime-local has no zone; the operators work in India time.
  const from=fromRaw?new Date(fromRaw+':00+05:30'):null;
  if(from&&Number.isNaN(+from))return {error:'The start date is not valid.'};
  const r=await startTrainingRun(actor,actor.tenant_id,{trigger:'manual',notes:String(form.get('notes')??''),from});
  id=r.id;
  // Start on the first step straight away; the run page keeps it moving.
  after(()=>advanceTrainingRuns({runId:id,budgetMs:15000}).catch(()=>{}));
 }catch(e){return {error:message(e)};}
 redirect(`/ops/ai-training/${id}`);
}

/** One unit of work (a review step or the merge). The run page calls this until the run is done. */
export async function advanceRunAction(runId:string):Promise<{progressed:boolean;error?:string}>{
 try{await trainer();return {progressed:await advanceTrainingRun(runId)};}
 catch(e){return {progressed:false,error:message(e)};}
}

export async function reviewSuggestionAction(runId:string,suggestionId:string,_:unknown,form:FormData):Promise<{error?:string;saved?:boolean}>{
 try{
  const actor=await trainer();
  const status=String(form.get('status')??'');
  await reviewSuggestion(actor,suggestionId,{status:status as 'accepted'|'rejected'|'pending',edited_change:String(form.get('edited_change')??''),reviewer_note:String(form.get('reviewer_note')??'')});
  revalidatePath(`/ops/ai-training/${runId}`);
  return {saved:true};
 }catch(e){return {error:message(e)};}
}

export async function approveRunAction(runId:string,_:unknown):Promise<{error?:string}>{
 try{const actor=await trainer();await approveTrainingRun(actor,runId);}
 catch(e){return {error:message(e)};}
 revalidatePath(`/ops/ai-training/${runId}`);revalidatePath('/ops/ai-training');
 return {};
}

export async function retryRunAction(runId:string,_:unknown):Promise<{error?:string}>{
 try{const actor=await trainer();await retryTrainingRun(actor,runId);}
 catch(e){return {error:message(e)};}
 revalidatePath(`/ops/ai-training/${runId}`);
 return {};
}
