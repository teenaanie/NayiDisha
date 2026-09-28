import {sql} from '@/lib/db';
import {fmtDateTime} from '@/lib/clock';
import {Pill,StatusPill} from './ui';
import {identity} from '@/lib/auth';
export async function CandidateRecord({id}:{id:string}){
 const [profiles,tests,apps,consents,attrs,voice,script,resumes,practice]=await Promise.all([sql`SELECT c.*,p.name partner FROM app.candidate c LEFT JOIN app.attribution a ON a.candidate_id=c.id LEFT JOIN app.partner p ON p.id=a.partner_id WHERE c.id=${id}`,sql`SELECT score,completed_at FROM app.assessment_attempt WHERE candidate_id=${id} ORDER BY completed_at DESC`,sql`SELECT a.*,j.title FROM app.application a JOIN app.job j ON j.id=a.job_id WHERE a.candidate_id=${id} ORDER BY applied_at DESC`,sql`SELECT purpose,granted_at,withdrawn_at FROM app.consent_record WHERE candidate_id=${id}`,sql`SELECT d.display_name,v.value_text,v.value_bool,v.value_int FROM app.candidate_attribute_value v JOIN app.attribute_definition d ON d.key=v.attribute_key WHERE candidate_id=${id}`,sql`SELECT field,transcript,interpreted,confidence,provider,accepted,created_at FROM app.voice_turn WHERE candidate_id=${id} ORDER BY created_at`,sql`SELECT r.id run_id,r.script_id,r.script_version,r.score run_score,r.status,p.turn_key,p.kind,p.transcript,p.interpreted,p.score,p.max_score,p.rubric_version,p.scorer,p.reasoning,p.credits,p.confidence,p.needs_review FROM app.script_run r LEFT JOIN app.script_response p ON p.run_id=r.id WHERE r.candidate_id=${id} ORDER BY r.started_at DESC,r.id DESC,p.created_at`,sql`SELECT id,filename,size_bytes,source,uploaded_at FROM app.candidate_resume WHERE candidate_id=${id} ORDER BY uploaded_at DESC`,sql`SELECT s.id,s.scenario_id,s.language,s.status,s.started_at,s.retry_of,e.overall,e.max_score,e.band,e.evaluator,e.needs_review,jsonb_array_length(COALESCE(e.risk_flags,'[]'))::int risks FROM app.simulation_session s LEFT JOIN app.simulation_evaluation e ON e.session_id=s.id WHERE s.candidate_id=${id} AND s.status<>'ABANDONED' ORDER BY s.started_at DESC LIMIT 10`]);
 const c=profiles[0];if(!c)return <p>Candidate not found.</p>;
 const viewer=await identity();const reportHref=(sid:string)=>viewer?.role==='CANDIDATE'?'/wa/practice/'+sid:'/ops/simulations/'+sid;
 const fields=Object.entries({
  Mobile:c.phone,Locality:c.locality_key,Education:c.education,
  Experience:c.experience_months+' months',Skills:c.experience_tags.join(', '),
  Languages:c.languages.join(', '),'Expected monthly pay':'₹'+Number(c.expected_pay_paise||0)/100,
  'Commute limit':c.max_commute_min+' minutes',Availability:c.shift_availability.join(', '),
  'Referred by':c.partner||'Direct',
 });
 // Captured by the WhatsApp registration form; shown only when present.
 const registration=Object.entries({
  Email:c.email,'Pin code':c.pin_code,'Date of birth':c.date_of_birth?new Date(c.date_of_birth).toISOString().slice(0,10):null,
  Gender:c.gender?String(c.gender).toLowerCase():null,'Highest qualification':c.highest_qualification?String(c.highest_qualification).replace(/_/g,' ').toLowerCase():null,
  'Current industry':c.current_industry,'Current role':c.current_job_role,'Current company':c.current_company,
  'Current monthly pay':c.current_pay_paise!=null?'₹'+Number(c.current_pay_paise)/100:null,
 }).filter(([,v])=>v);
 return <>
  <div className="page-head flexb">
   <h2>{c.name||'Profile in progress'}</h2>
   <StatusPill status={c.status}/>
  </div>

  <div className="card mb"><div className="card-body"><div className="grid g2">
   {fields.map(([k,v])=><div className="field" key={k}><label>{k}</label><div>{v||'Not provided'}</div></div>)}
  </div></div></div>

  {(registration.length>0||resumes.length>0)&&<div className="card mb">
   <div className="card-head"><h3>Registration details</h3>{c.registration_channel&&<span className="small muted">via {String(c.registration_channel).replace(/_/g,' ').toLowerCase()}</span>}</div>
   <div className="card-body"><div className="grid g2">
    {registration.map(([k,v])=><div className="field" key={k}><label>{k}</label><div>{String(v)}</div></div>)}
    {resumes[0]&&<div className="field"><label>Resume</label><div><a href={'/api/resume/'+resumes[0].id}>{resumes[0].filename}</a> <span className="small muted">{Math.ceil(resumes[0].size_bytes/1024)} KB · {fmtDateTime(resumes[0].uploaded_at)}</span></div></div>}
   </div></div>
  </div>}

  {attrs.length>0&&<div className="card mb">
   <div className="card-head"><h3>Role details</h3></div>
   <div className="card-body"><div className="grid g2">
    {attrs.map((a,i)=><div className="field" key={i}><label>{a.display_name}</label><div>{String(a.value_text??a.value_bool??a.value_int??'Not provided')}</div></div>)}
   </div></div>
  </div>}

  <div className="card mb">
   <div className="card-head"><h3>Profile checklist</h3></div>
   <div className="card-body"><div className="tags">
    {([['Name',!!c.name],['Locality',!!c.locality_key],['Role',!!c.role_config_id],['Assessment',tests.length>0]] as const).map(([label,done])=>
     <Pill key={label} tone={done?'ok':'mute'}>{done?'✓ ':'○ '}{label}</Pill>)}
   </div></div>
  </div>

  <div className="card mb">
   <div className="card-head"><h3>Assessment results</h3></div>
   <div className="card-body">
    {tests.length
     ? <div className="tags">{tests.map((t,i)=><Pill key={i} tone="info">{t.score}% · {fmtDateTime(t.completed_at)}</Pill>)}</div>
     : <p className="muted">Awaiting assessment</p>}
   </div>
  </div>

  <div className="card mb">
   <div className="card-head"><h3>Applications &amp; sharing history</h3></div>
   <div className="card-body tight">
    {apps.length===0
     ? <div className="empty">No applications yet.</div>
     : apps.map((a,i)=><div className="card-body" style={i>0?{borderTop:'1px solid var(--line)'}:undefined} key={a.id}>
        <div className="flexb"><strong>{a.title}</strong><StatusPill status={a.status}/></div>
        <p className="small muted">
         Applied {fmtDateTime(a.applied_at)} · {a.reconfirmed_at?'Interest confirmed '+fmtDateTime(a.reconfirmed_at):'Awaiting confirmation'}
        </p>
        <details><summary className="small">Consent recorded at application</summary><pre className="small">{JSON.stringify(a.consent_snapshot,null,2)}</pre></details>
       </div>)}
   </div>
  </div>

  {voice.length>0&&<div className="card mb">
   <div className="card-head"><h3>Voice answers</h3><span className="small muted">what was said vs. what was understood</span></div>
   <div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Question</th><th>Said</th><th>Understood</th><th>Confidence</th><th>Source</th></tr></thead>
    <tbody>{voice.map((v:any,i:number)=><tr key={i}>
     <td className="small">{String(v.field).replace(/([A-Z])/g,' $1').toLowerCase()}</td>
     <td className="small">“{v.transcript}”</td>
     <td className="small">{v.interpreted?.display||'—'}{v.accepted&&<Pill tone="ok">confirmed</Pill>}</td>
     <td className="num">{Math.round(Number(v.confidence)*100)}%</td>
     <td className="small muted mono">{v.provider}</td>
    </tr>)}</tbody>
   </table></div></div>
  </div>}
  {script.length>0&&script[0].run_id&&<div className="card mb">
   <div className="card-head"><h3>Skill answers</h3><span className="small muted">role script · {String(script[0].script_id)} v{String(script[0].script_version)} · score {String(script[0].run_score??'—')}/100</span></div>
   <div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Question</th><th>Said</th><th>Credited</th><th>Score</th><th>Confidence</th><th>Scorer</th></tr></thead>
    <tbody>{script.filter((r:any)=>r.turn_key).map((r:any,i:number)=><tr key={i}>
     <td className="small">{r.turn_key}{r.needs_review&&<Pill tone="warn">needs review</Pill>}</td>
     <td className="small">“{r.transcript}”</td>
     <td className="small">{r.kind==='SKILL'?((r.credits||[]).length?(r.credits as string[]).join('; '):'none'):(r.interpreted?.display||'—')}</td>
     <td className="num">{r.kind==='SKILL'?`${r.score}/${r.max_score}`:'—'}</td>
     <td className="num">{Math.round(Number(r.confidence)*100)}%</td>
     <td className="small muted mono">{r.scorer||'—'}{r.rubric_version?` · ${r.rubric_version}`:''}</td>
    </tr>)}</tbody>
   </table></div>
   {script.some((r:any)=>r.needs_review)&&<p className="small muted">Some answers were scored without a model, or with low confidence. Treat those scores as provisional until a person has read them.</p>}
   </div>
  </div>}
  {practice.length>0&&<div className="card mb">
   <div className="card-head"><h3>Sales practice</h3><span className="small muted">AI roleplay, scored by a separate evaluator</span></div>
   <div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Started</th><th>Scenario</th><th>Language</th><th>Score</th><th>Evaluator</th><th></th></tr></thead>
    <tbody>{practice.map((p:any)=><tr key={p.id}>
     <td className="small">{fmtDateTime(p.started_at)}{p.retry_of&&<Pill tone="info">retry</Pill>}</td>
     <td className="small">{p.scenario_id}</td><td className="small">{p.language}</td>
     <td className="num">{p.overall!=null?`${p.overall}/${p.max_score} · ${p.band}`:p.status.toLowerCase().replace('_',' ')}{p.risks>0&&<Pill tone="bad">risk</Pill>}{p.needs_review&&<Pill tone="warn">needs review</Pill>}</td>
     <td className="small muted mono">{p.evaluator||'—'}</td>
     <td>{p.overall!=null&&<a href={reportHref(p.id)}>Report</a>}</td>
    </tr>)}</tbody>
   </table></div></div>
  </div>}
  <div className="card">
   <div className="card-head"><h3>Consent choices</h3></div>
   <div className="card-body"><div className="tags">
    {consents.map((cn)=><Pill key={cn.purpose} tone={cn.withdrawn_at?'bad':'ok'}>
     {cn.purpose.replace(/_/g,' ').toLowerCase()}: {cn.withdrawn_at?'Withdrawn '+fmtDateTime(cn.withdrawn_at):'Granted '+fmtDateTime(cn.granted_at)}
    </Pill>)}
   </div></div>
  </div>
 </>;
}
