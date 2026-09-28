import {identity} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {SubNav,CANDIDATE_TABS} from '../../subnav';
import {Pill,StatusPill} from '../../ui';
import {publishedScenarios,candidateSessions} from '@/modules/simulation';
import {LANGUAGE_NAMES,type SarvamLanguage} from '@/modules/adapters/sarvam';
import {practiceLanguages} from './actions';
import {StartPractice} from './practice-client';
export const dynamic='force-dynamic';

export default async function Practice(){
 const actor=await identity();
 if(actor?.role!=='CANDIDATE')return <><SubNav tabs={CANDIDATE_TABS}/><main className="page"><div className="page-head"><h1>Sales practice</h1><p>Sign in as a candidate to practise a sales conversation.</p></div><a className="btn btn-primary" href="/sign-in">Sign in</a></main></>;
 const [scenarios,sessions,languages]=await Promise.all([publishedScenarios(),candidateSessions(actor.id),practiceLanguages()]);
 const options=languages.map(l=>({value:l,label:LANGUAGE_NAMES[l as SarvamLanguage]}));
 return <><SubNav tabs={CANDIDATE_TABS}/><main className="page">
  <div className="page-head"><div className="nd-section-kicker">Practise before the real thing</div><h1>Sales practice</h1><p>Talk to an AI customer in your language, by typing or speaking. When you finish, you get a score against the same rubric a trainer would use, and specific tips for your next attempt.</p></div>
  <div className="grid g2 mb">{scenarios.map(s=><section className="card" key={s.id}>
   <div className="card-head"><h2>{s.title}</h2></div>
   <div className="card-body">
    <div className="tags mb"><Pill tone="info">{s.product}</Pill><Pill>{s.skill}</Pill><Pill>{s.difficulty}</Pill><Pill>{s.duration_min} minutes</Pill></div>
    <p className="small muted mb">You play: {s.learner_role}</p>
    <StartPractice scenarioId={s.id} languages={options}/>
   </div>
  </section>)}</div>
  <section className="card"><div className="card-head"><h2>Your attempts</h2></div>
   {sessions.length===0?<div className="card-body"><p className="muted">No attempts yet.</p></div>:<div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Started</th><th>Language</th><th>Status</th><th>Score</th><th></th></tr></thead>
    <tbody>{sessions.map((s:any)=><tr key={s.id}>
     <td className="small">{fmtDateTime(s.started_at)}{s.retry_of&&<Pill tone="info">retry</Pill>}</td>
     <td className="small">{LANGUAGE_NAMES[s.language as SarvamLanguage]||s.language}</td>
     <td><StatusPill status={s.status}/></td>
     <td className="num">{s.overall!=null?`${s.overall}/${s.max_score} · ${s.band}`:'—'}</td>
     <td>{s.status!=='ABANDONED'&&<a href={'/wa/practice/'+s.id}>{s.status==='IN_PROGRESS'?'Continue':'View report'}</a>}</td>
    </tr>)}</tbody>
   </table></div></div>}
  </section>
 </main></>;
}
