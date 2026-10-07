'use server';
import {revalidatePath} from 'next/cache';
import {requireRole} from '@/lib/auth';
import {operatorActor} from '@/modules/roleplay/service/auth';
import {ApiError} from '@/modules/roleplay/service/context';
import {setAssessmentAttempts} from '@/modules/roleplay/service/assessment';

/** Set how many graded attempts a candidate has for one scenario. */
export async function setAttemptsAction(learnerId:string,scenarioId:string,_:unknown,form:FormData):Promise<{error?:string;saved?:string}>{
 try{
  await requireRole(['ADMIN','OPERATIONS']);
  const actor=await operatorActor();
  if(!actor)throw new ApiError(401,'UNAUTHENTICATED','Sign in again.');
  const r=await setAssessmentAttempts(actor,{learner_id:learnerId,scenario_id:scenarioId,attempts_allowed:Number(form.get('attempts')),reason:String(form.get('reason')??'')});
  revalidatePath('/ops/assessments');
  return {saved:r.changed?`Saved: ${r.attempts_used} of ${r.attempts_allowed} used`:'No change'};
 }catch(e){return {error:e instanceof ApiError?e.message:'Could not save. Try again.'};}
}
