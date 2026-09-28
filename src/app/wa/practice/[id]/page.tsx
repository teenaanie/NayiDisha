import {notFound} from 'next/navigation';
import {sql} from '@/lib/db';
import {requireRole} from '@/lib/auth';
import {SubNav,CANDIDATE_TABS} from '../../../subnav';
import {sessionDetail,pick} from '@/modules/simulation';
import {sarvamConfigured,LANGUAGE_NAMES,type SarvamLanguage} from '@/modules/adapters/sarvam';
import {practiceLanguages} from '../actions';
import {PracticeChat,StartPractice} from '../practice-client';
import {PracticeReport} from '../report';
export const dynamic='force-dynamic';

export default async function PracticeSession({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const c=await requireRole(['CANDIDATE']);
 const detail=await sessionDetail(c.id,id);
 if(!detail)notFound();
 const {session,scenario,turns,evaluation}=detail;
 const lang=session.language as SarvamLanguage;
 const head=<div className="page-head"><div className="nd-section-kicker">Sales practice · {LANGUAGE_NAMES[lang]}</div><h1>{scenario.title}</h1></div>;

 if(session.status==='IN_PROGRESS'){
  const [consent]=await sql`SELECT 1 FROM app.consent_record WHERE candidate_id=${c.id} AND purpose='SIMULATION_VOICE' AND granted_at IS NOT NULL AND withdrawn_at IS NULL`;
  // Browser speech covers only the languages Chrome recognises well; beyond those, type.
  const voice=sarvamConfigured()?'sarvam':['en','hi','mr'].includes(lang)?'browser':'none';
  return <><SubNav tabs={CANDIDATE_TABS}/><main className="page">{head}
   <PracticeChat sessionId={session.id} customerName={scenario.customerProfile.name} learnerRole={scenario.learnerRole}
    brief={pick(scenario.learnerBrief,lang)} focus={session.retry_focus} language={lang}
    turns={turns.map(t=>({seq:t.seq,speaker:t.speaker,text:t.text}))} startedAt={new Date(session.started_at).toISOString()}
    durationMin={scenario.durationMin} maxTurns={scenario.maxTurns} voice={voice} voiceConsent={!!consent}/>
  </main></>;
 }

 const languages=(await practiceLanguages()).map(l=>({value:l,label:LANGUAGE_NAMES[l as SarvamLanguage]}));
 return <><SubNav tabs={CANDIDATE_TABS}/><main className="page">{head}
  {evaluation?<PracticeReport evaluation={evaluation} turns={turns} customerName={scenario.customerProfile.name}/>:<p className="muted">This attempt ended without a score.</p>}
  <section className="card mb"><div className="card-head"><h2>Try again</h2></div><div className="card-body">
   <p className="small muted">A retry starts a fresh conversation with the same customer, with your focus areas shown in the brief.</p>
   <StartPractice scenarioId={scenario.id} languages={languages} retryOf={evaluation?session.id:undefined} label="Start a retry"/>
  </div></section>
  <a href="/wa/practice">Back to sales practice</a>
 </main></>;
}
