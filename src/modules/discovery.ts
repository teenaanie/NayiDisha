import {sql} from '@/lib/db';import {now} from '@/lib/clock';import {computeMatch,recordMatch} from './matching';import {dispatchJobAlerts} from './alerts';import {nextId} from '@/lib/ids';import {mapWithConcurrency} from '@/lib/concurrency';
export async function refreshCandidate(id:string,jobId?:string){const at=await now();const jobs=await sql`SELECT j.id FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id WHERE (${jobId||null}::text IS NULL OR j.id=${jobId||null}) AND j.status='LIVE' AND e.status='VERIFIED' AND (j.expires_at IS NULL OR j.expires_at>${at})`;await mapWithConcurrency(jobs,async j=>{const m=await computeMatch(id,j.id);const eligible=m.stageA.pass&&m.stageB.reasons.every(x=>['NO_APPLICATION','INTEREST_NOT_RECONFIRMED'].includes(x));await sql`INSERT INTO app.job_suggestion(candidate_id,job_id,score,explanation,gaps,eligible,updated_at) VALUES(${id},${j.id},${m.score},${sql.json(m.explanation)},${sql.json(m.gaps)},${eligible},${at}) ON CONFLICT(candidate_id,job_id) DO UPDATE SET score=EXCLUDED.score,explanation=EXCLUDED.explanation,gaps=EXCLUDED.gaps,eligible=EXCLUDED.eligible,updated_at=EXCLUDED.updated_at`;const [a]=await sql`SELECT id FROM app.application WHERE candidate_id=${id} AND job_id=${j.id} AND status NOT IN ('WITHDRAWN','REJECTED','JOINED')`;if(a)await recordMatch(a.id,id,j.id,m);if(eligible)await dispatchJobAlerts(j.id,id,m);});}
/**
 * Refresh that never throws.
 *
 * This runs inside Next's `after()`, where nothing is left to catch a rejection
 * and the serverless function dies with exit 128 — taking the in-flight request
 * with it. The fallback write has to be guarded too: it is the path that runs
 * when the database is already unhappy, so it is exactly the write most likely
 * to fail in turn.
 */
export async function safelyRefreshCandidate(id:string){
 try{
  await refreshCandidate(id);
 }catch{
  try{
   await sql`INSERT INTO app.workflow_issue(id,candidate_id,kind,detail) VALUES(${await nextId('ISS')},${id},'MATCHING_RETRY','Matching did not finish. Retry from Exceptions.')`;
  }catch{ /* Nothing left to do: the candidate is saved, only the match is stale. */ }
 }
}

export async function refreshJobCandidates(jobId:string){const candidates=await sql`SELECT id FROM app.candidate WHERE status='PROFILE_ACTIVE'`;await mapWithConcurrency(candidates,async c=>{try{await refreshCandidate(c.id,jobId);}catch{try{await sql`INSERT INTO app.workflow_issue(id,candidate_id,kind,detail) VALUES(${await nextId('ISS')},${c.id},'MATCHING_RETRY','New job matching needs retry')`;}catch{ /* Same reasoning as safelyRefreshCandidate. */ }}});}
