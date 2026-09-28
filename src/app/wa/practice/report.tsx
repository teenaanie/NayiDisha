import {Pill} from '../../ui';
import type {Turn} from '@/modules/simulation';

/** The learner's coaching report. Also reused, with operations detail, on the candidate record. */
export function PracticeReport({evaluation:e,turns,customerName,forOps=false}:{evaluation:any;turns:Turn[];customerName:string;forOps?:boolean}){
 const coverage=(e.coverage||[]) as {key:string;label:string;asked:boolean}[];
 const flags=(e.risk_flags||[]) as {label:string;quote:string;turnSeq:number}[];
 return <div className="practice-report">
  <section className="card mb"><div className="card-head"><h2>{e.overall}/{e.max_score} · {e.band}</h2>
   <span className="small muted">{forOps?`${e.evaluator} · ${e.rubric_version}`:'Scored against the discovery rubric'}{e.needs_review&&<> <Pill tone="warn">{forOps?'needs review':'provisional'}</Pill></>}</span></div>
   <div className="card-body"><div className="bars">
    {(e.dimension_scores as any[]).map(d=><div key={d.key} className="mb">
     <div className="bar"><span>{d.label}</span><span className="track"><span className="fill" style={{width:(d.score/5*100)+'%'}}/></span><span className="val">{d.score}/5</span></div>
     <p className="small muted">{d.evidence}</p>
    </div>)}
   </div></div>
  </section>

  <div className="grid g2 mb">
   <section className="card"><div className="card-head"><h3>Strengths</h3></div><div className="card-body"><ul>{(e.strengths as string[]).map((s,i)=><li key={i}>{s}</li>)}</ul>
    {e.best_moment&&<><h4>Best moment</h4><blockquote>{e.best_moment}</blockquote></>}</div></section>
   <section className="card"><div className="card-head"><h3>To improve</h3></div><div className="card-body"><ul>{(e.improvements as string[]).map((s,i)=><li key={i}>{s}</li>)}</ul>
    {e.missed_opportunity&&<><h4>Missed opportunity</h4><blockquote>{e.missed_opportunity}</blockquote></>}</div></section>
  </div>

  {flags.length>0&&<div className="note bad mb"><strong>Compliance risk.</strong> {flags.map((f,i)=><div key={i}>{f.label}: “{f.quote}”</div>)}</div>}

  <section className="card mb"><div className="card-head"><h3>What you found out</h3></div><div className="card-body"><div className="tags">
   {coverage.map(c=><Pill key={c.key} tone={c.asked?'ok':'mute'}>{c.asked?'✓ ':'○ '}{c.label}</Pill>)}
  </div>
  {e.retry?.instruction&&<><h4>Suggested retry</h4><p>{e.retry.instruction}</p>{(e.retry.questions||[]).length>0&&<ul className="small">{(e.retry.questions as string[]).map((q,i)=><li key={i}>“{q}”</li>)}</ul>}</>}
  </div></section>

  <details className="mb"><summary>Transcript ({turns.length} messages)</summary>
   <div className="card-body">{turns.map(t=><p key={t.seq} className="small"><strong>{t.speaker==='CUSTOMER'?customerName:forOps?'Candidate':'You'}:</strong> {t.text}{forOps&&t.textEn&&t.textEn!==t.text&&<span className="muted"> ({t.textEn})</span>}</p>)}</div>
  </details>
 </div>;
}
