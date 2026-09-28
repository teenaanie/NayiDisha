import {notFound} from 'next/navigation';
import {scopePage} from '@/lib/auth';
import {sessionDetail} from '@/modules/simulation';
import {PracticeReport} from '../../../wa/practice/report';
export const dynamic='force-dynamic';

export default async function SimulationReport({params}:{params:Promise<{id:string}>}){
 await scopePage('ops');const {id}=await params;
 const detail=await sessionDetail(null,id);
 if(!detail)notFound();
 const {session,scenario,turns,evaluation}=detail;
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Sales practice · {session.language} · {session.status.toLowerCase()}</div><h1>{scenario.title}</h1>
   <p><a href={'/ops/candidates/'+session.candidate_id}>{session.candidate_id}</a> · customer agent {session.customer_agent||'—'}{session.pitched_early?' · pitched before discovery':''}</p></div>
  {evaluation?<PracticeReport evaluation={evaluation} turns={turns} customerName={scenario.customerProfile.name} forOps/>:<p className="muted">Not scored.</p>}
  <a href="/ops/simulations">Back to sales practice</a>
 </main>;
}
