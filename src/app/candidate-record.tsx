import {sql} from '@/lib/db';
import {fmtDateTime} from '@/lib/clock';
import {Pill,StatusPill} from './ui';
export async function CandidateRecord({id}:{id:string}){
 const [profiles,tests,apps,consents,attrs]=await Promise.all([sql`SELECT c.*,p.name partner FROM app.candidate c LEFT JOIN app.attribution a ON a.candidate_id=c.id LEFT JOIN app.partner p ON p.id=a.partner_id WHERE c.id=${id}`,sql`SELECT score,completed_at FROM app.assessment_attempt WHERE candidate_id=${id} ORDER BY completed_at DESC`,sql`SELECT a.*,j.title FROM app.application a JOIN app.job j ON j.id=a.job_id WHERE a.candidate_id=${id} ORDER BY applied_at DESC`,sql`SELECT purpose,granted_at,withdrawn_at FROM app.consent_record WHERE candidate_id=${id}`,sql`SELECT d.display_name,v.value_text,v.value_bool,v.value_int FROM app.candidate_attribute_value v JOIN app.attribute_definition d ON d.key=v.attribute_key WHERE candidate_id=${id}`]);
 const c=profiles[0];if(!c)return <p>Candidate not found.</p>;
 const fields=Object.entries({
  Mobile:c.phone,Locality:c.locality_key,Education:c.education,
  Experience:c.experience_months+' months',Skills:c.experience_tags.join(', '),
  Languages:c.languages.join(', '),'Expected monthly pay':'₹'+Number(c.expected_pay_paise||0)/100,
  'Commute limit':c.max_commute_min+' minutes',Availability:c.shift_availability.join(', '),
  'Referred by':c.partner||'Direct',
 });
 return <>
  <div className="page-head flexb">
   <h2>{c.name||'Profile in progress'}</h2>
   <StatusPill status={c.status}/>
  </div>

  <div className="card mb"><div className="card-body"><div className="grid g2">
   {fields.map(([k,v])=><div className="field" key={k}><label>{k}</label><div>{v||'Not provided'}</div></div>)}
  </div></div></div>

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
