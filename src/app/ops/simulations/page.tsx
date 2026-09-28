import {scopePage} from '@/lib/auth';
import {sql} from '@/lib/db';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../ui';
import {EmptyState} from '../../workspace-components';
export const dynamic='force-dynamic';

/**
 * Manager view of sales practice: where learners are weak, who shows
 * compliance risk, and whether retries help. One round trip, like the dashboard.
 */
export default async function Simulations(){
 await scopePage('ops');
 const [d]=await sql`SELECT
  (SELECT json_build_object(
     'started',count(*),
     'completed',count(*) FILTER (WHERE status IN ('COMPLETED','TIMED_OUT')),
     'abandoned',count(*) FILTER (WHERE status='ABANDONED'),
     'learners',count(DISTINCT candidate_id)) FROM app.simulation_session) AS totals,
  (SELECT COALESCE(round(avg(overall),1),0) FROM app.simulation_evaluation) AS avg_overall,
  (SELECT COALESCE(json_agg(x ORDER BY x.avg),'[]'::json) FROM (
     SELECT d->>'key' AS key, d->>'label' AS label, round(avg((d->>'score')::numeric),2) AS avg
       FROM app.simulation_evaluation e, jsonb_array_elements(e.dimension_scores) d GROUP BY 1,2) x) AS dimensions,
  (SELECT COALESCE(json_agg(x ORDER BY x.pct),'[]'::json) FROM (
     SELECT c->>'key' AS key, c->>'label' AS label,
            round(100.0*count(*) FILTER (WHERE (c->>'asked')::boolean)/count(*)) AS pct
       FROM app.simulation_evaluation e, jsonb_array_elements(e.coverage) c GROUP BY 1,2) x) AS coverage,
  (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC),'[]'::json) FROM (
     SELECT s.candidate_id, c.name, f->>'label' AS label, f->>'quote' AS quote, e.created_at, s.id AS session_id
       FROM app.simulation_evaluation e JOIN app.simulation_session s ON s.id=e.session_id JOIN app.candidate c ON c.id=s.candidate_id,
            jsonb_array_elements(e.risk_flags) f ORDER BY e.created_at DESC LIMIT 25) x) AS risks,
  (SELECT json_build_object('pairs',count(*),'gain',COALESCE(round(avg(r.overall-o.overall),1),0))
     FROM app.simulation_session s JOIN app.simulation_evaluation r ON r.session_id=s.id
     JOIN app.simulation_evaluation o ON o.session_id=s.retry_of) AS retries,
  (SELECT COALESCE(json_agg(x ORDER BY x.best DESC),'[]'::json) FROM (
     SELECT s.candidate_id, c.name, count(*) AS attempts, max(e.overall) AS best, max(e.max_score) AS max_score,
            (array_agg(e.band ORDER BY e.overall DESC))[1] AS band, max(e.created_at) AS last_at,
            bool_or(jsonb_array_length(e.risk_flags)>0) AS risk
       FROM app.simulation_evaluation e JOIN app.simulation_session s ON s.id=e.session_id JOIN app.candidate c ON c.id=s.candidate_id
      GROUP BY 1,2 LIMIT 100) x) AS learners`;
 const t=d.totals;const weakest=d.coverage[0];
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Coaching analytics</div><h1>Sales practice</h1><p>How candidates perform in AI roleplay: which discovery skills are weak across learners, who shows compliance risk, and whether retries improve scores.</p></div>
  <div className="tilegrid mb">
   {([['Learners',t.learners],['Attempts completed',`${t.completed} of ${t.started}`],['Average score',`${d.avg_overall}/30`],['Gain after retry',d.retries.pairs?`${Number(d.retries.gain)>0?'+':''}${d.retries.gain} (${d.retries.pairs})`:'—']] as const).map(([k,v])=><div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
  </div>
  {t.completed===0?<section className="card"><div className="card-body"><EmptyState title="No completed practice yet" description="Scores appear here once candidates finish a conversation."/></div></section>:<>
  {weakest&&<div className="note mb">Only {weakest.pct}% of attempts asked about <strong>{String(weakest.label).toLowerCase()}</strong>. Consider a short module on it before the next practice round.</div>}
  <div className="grid g2 mb">
   <section className="card"><div className="card-head"><h2>Average by skill</h2></div><div className="card-body"><div className="bars">
    {d.dimensions.map((x:any)=><div className="bar" key={x.key}><span>{x.label}</span><span className="track"><span className="fill" style={{width:(x.avg/5*100)+'%'}}/></span><span className="val">{x.avg}/5</span></div>)}
   </div></div></section>
   <section className="card"><div className="card-head"><h2>Questions asked</h2><span className="small muted">share of attempts</span></div><div className="card-body"><div className="bars">
    {d.coverage.map((x:any)=><div className="bar" key={x.key}><span>{x.label}</span><span className="track"><span className="fill" style={{width:x.pct+'%'}}/></span><span className="val">{x.pct}%</span></div>)}
   </div></div></section>
  </div>
  <section className="card mb"><div className="card-head"><h2>Compliance risk statements</h2></div>
   {d.risks.length===0?<div className="card-body"><p className="muted">None recorded.</p></div>:<div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Candidate</th><th>Risk</th><th>What they said</th><th>When</th></tr></thead>
    <tbody>{d.risks.map((r:any,i:number)=><tr key={i}><td><a href={'/ops/candidates/'+r.candidate_id}>{r.name||r.candidate_id}</a></td><td><Pill tone="bad">{r.label}</Pill></td><td className="small">“{r.quote}”</td><td className="small">{fmtDateTime(r.created_at)}</td></tr>)}</tbody>
   </table></div></div>}
  </section>
  <section className="card"><div className="card-head"><h2>Readiness by learner</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>Candidate</th><th>Attempts</th><th>Best</th><th>Band</th><th>Risk</th><th>Last attempt</th></tr></thead>
   <tbody>{d.learners.map((l:any)=><tr key={l.candidate_id}><td><a href={'/ops/candidates/'+l.candidate_id}>{l.name||l.candidate_id}</a></td><td className="num">{l.attempts}</td><td className="num">{l.best}/{l.max_score}</td>
    <td><Pill tone={l.best>=25?'ok':l.best>=19?'info':l.best>=13?'warn':'bad'}>{l.band}</Pill></td><td>{l.risk?<Pill tone="bad">flagged</Pill>:'—'}</td><td className="small">{fmtDateTime(l.last_at)}</td></tr>)}</tbody>
  </table></div></div></section>
  </>}
 </main>;
}
