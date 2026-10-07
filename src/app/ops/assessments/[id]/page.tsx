import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {fmtDateTime} from '@/lib/clock';
import {sql} from '@/lib/db';
import {Pill} from '../../../ui';
import {getReport} from '@/modules/roleplay/service';
import {operatorActor} from '@/modules/roleplay/service/auth';
import {ScoreSheet} from '../../../roleplay/s/[id]/report/score-sheet';
import {STATE} from '../labels';
export const dynamic='force-dynamic';

type Dim={dimension_id:string;name:string;score:number;max_score:number;weight:number|null;measures:string|null;rationale:string};
type Turn={turn_id:string;speaker:string;text:string;input_mode:string;asr_edited:boolean|null};

/** One graded assessment in full: score sheet, risk flags, the assessor's rationale per skill, and the transcript. */
export default async function AssessmentDetail({params}:{params:Promise<{id:string}>}){
 await scopePage('ops');
 const {id}=await params;
 const actor=await operatorActor();
 const back=<p><Link href="/ops/assessments">← Assessments</Link></p>;
 if(!actor)return <main className="page">{back}<div className="note bad">Sign in again to open this assessment.</div></main>;
 let r;
 try{r=await getReport(actor,id);}catch(e){return <main className="page">{back}<h1>Assessment not available</h1><p>{(e as Error).message}</p></main>;}
 const [s]=await sql<{learner:string;subject:string;state:string;started_at:Date;completed_at:Date|null;kind:string}[]>`SELECT u.display_name AS learner,u.subject,s.state,s.started_at,s.completed_at,s.kind FROM rp.session s JOIN rp.app_user u ON u.id=s.learner_id WHERE s.id=${id} AND s.tenant_id=${actor.tenant_id}`;
 if(r.status===202)return <main className="page">{back}<h1>{s?.learner}: being scored</h1><p>The evaluator is still reading this conversation. Refresh in a minute.</p></main>;
 const b=r.body as any;
 const head=<>{back}<div className="page-head"><div className="nd-section-kicker">{s?.kind==='assessment'?'Graded assessment':'Practice'} · {b.scenario?.title??''}{b.scenario?` · v${b.scenario.version}`:''}</div>
  <h1>{s?.subject.startsWith('nd:candidate:')?<Link href={`/ops/candidates/${encodeURIComponent(s.subject.slice('nd:candidate:'.length))}`}>{s.learner}</Link>:s?.learner}{b.assessment?` · ${b.assessment.final_percent}/100 · ${b.assessment.band_label}`:''}</h1>
  <p>{s&&<>Started {fmtDateTime(s.started_at)}{s.completed_at?` · finished ${fmtDateTime(s.completed_at)}`:''} · </>}<Pill tone={STATE[b.state]?.tone??STATE[s?.state]?.tone??'mute'}>{STATE[b.state]?.label??STATE[s?.state]?.label??b.state}</Pill></p></div></>;
 if(b.state==='evaluation_failed')return <main className="page">{head}<div className="note bad">This conversation could not be scored automatically. A reviewer can retry the scoring from the review queue.</div></main>;
 const dims=(b.dimensions??[]) as Dim[];
 const turns=(b.transcript??[]) as Turn[];
 return <main className="page">
  {head}
  <p className="small muted">The candidate sees only the score sheet. The evidence and transcript below are for NayiDisha staff; a graded assessment produces no coaching.</p>
  <ScoreSheet sheet={b.assessment??null} underReview={!!b.under_review}/>
  <section className="card mb"><div className="card-head"><h2>Risk flags</h2></div><div className="card-body">
   {(b.risk_findings as any[])?.length?<ul>{(b.risk_findings as any[]).map(f=><li key={f.rule_id}><strong>{f.description??f.rule_id}</strong> <Pill tone={f.status==='confirmed'?'bad':'warn'}>{f.status}</Pill>{f.reviewer_decision&&<> <Pill>{`reviewer: ${f.reviewer_decision}`}</Pill></>}</li>)}</ul>:<p className="muted small">No risk flagged.</p>}
  </div></section>
  {dims.length>0&&<section className="card mb"><div className="card-head"><h2>Assessor's evidence by skill</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>Skill</th><th>Weight</th><th>Score</th><th>Why</th></tr></thead>
   <tbody>{dims.map((d,i)=><tr key={d.dimension_id}><td><strong>{i+1}. {d.name}</strong>{d.measures&&<div className="small muted">{d.measures}</div>}</td><td>{d.weight!=null?`${d.weight}%`:'—'}</td><td><strong>{d.score}/{d.max_score}</strong></td><td className="small">{d.rationale}</td></tr>)}</tbody>
  </table></div></div></section>}
  <details open className="card mb"><summary className="card-head"><h2 style={{display:'inline'}}>Transcript</h2></summary><div className="card-body">
   {turns.map(t=><p key={t.turn_id} className="rp-turn small"><strong>{t.speaker==='customer'?'Customer':'Candidate'}{t.input_mode==='voice'?(t.asr_edited?' 🎤 (spoken, corrected before sending)':' 🎤 (spoken)'):''}:</strong> {t.text}</p>)}
  </div></details>
 </main>;
}
