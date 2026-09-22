import {PhoneFrame} from '../wa/phone-frame';
import {sql} from '@/lib/db';
import {identity} from '@/lib/auth';
import {readQuery} from '@/lib/read-query';
import {Suspense} from 'react';
import {Simulator} from '../wa/simulator';
import './apply.css';

export const dynamic='force-dynamic';

/**
 * The standalone applicant journey.
 *
 * Deliberately separate from /wa: no role switcher, no workspace sidebar, no
 * demo banner. A job seeker who scans a printed QR or opens a shared link sees
 * only this. `WorkspaceShell` early-returns for this section and the layout
 * suppresses the demo clock banner, so the page owns the whole viewport.
 *
 * The journey itself is unchanged — the same server actions, the same
 * attribution binding, the same step machine as /wa. Only the frame differs.
 */
async function ApplyData({searchParams}:{searchParams:Promise<{code?:string;edit?:string}>}){
 const {code,edit}=await searchParams;const actor=await identity();
 // One round trip, matching /wa — five reads would queue behind the serverless pool.
 const [data]=await readQuery(sql`SELECT
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT rc.id,rc.role_family_key,rc.candidate_attributes,rc.version,rc.role_script_id,rf.display_name FROM app.role_configuration rc JOIN app.role_family rf ON rf.key=rc.role_family_key WHERE rc.status='PUBLISHED' ORDER BY rc.id) x) AS configs,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT key,scope,data_type,display_name,translations,allowed_values FROM app.attribute_definition WHERE scope='CANDIDATE_ROLE') x) AS attributes,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT key,display_name FROM app.locality ORDER BY display_name) x) AS localities,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT j.id,j.description,j.preferred_skills,j.work_mode,j.qualification,j.expires_at,j.title,j.shift,j.fixed_pay_paise,j.variable_max_paise FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id WHERE j.status='LIVE' AND e.status='VERIFIED' AND (j.expires_at IS NULL OR j.expires_at>(SELECT now_at FROM app.demo_clock WHERE id=1)) ORDER BY j.id) x) AS jobs,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT c.*, (SELECT COALESCE(json_object_agg(attribute_key,COALESCE(value_text,value_bool::text,value_int::text)),'{}'::json) FROM app.candidate_attribute_value WHERE candidate_id=c.id) saved_attributes, EXISTS(SELECT 1 FROM app.assessment_attempt a WHERE a.candidate_id=c.id) AS has_assessment, EXISTS(SELECT 1 FROM app.consent_record r WHERE r.candidate_id=c.id AND r.purpose='PROCESSING' AND r.granted_at IS NOT NULL AND r.withdrawn_at IS NULL) AS has_consent FROM app.candidate c WHERE c.id=${actor?.role==='CANDIDATE'?actor.id:null}) x) AS profiles`);
 const {configs,attributes,localities,jobs,profiles}=data;

 const profile=profiles[0];
 if(profile?.status==='DELETED_BLOCKED')throw new Error('This profile is no longer active.');
 const step=!profile?'start':!profile.mobile_verified_at?'otp':!profile.has_consent?'consent':profile.status!=='PROFILE_ACTIVE'||!profile.name||!profile.role_config_id||!profile.work_authorised?'profile':!profile.has_assessment?'assess':'jobs';
 return <Simulator configs={configs} attributes={attributes} localities={localities} jobs={jobs} resume={edit==='profile'&&profile?'profile':step} existing={profiles[0]||null} source={code||''}/>;
}

async function ApplyContent(props:{searchParams:Promise<{code?:string;edit?:string}>}){
 try{return await ApplyData(props);}catch{return <div className="wa-msg wa-in" role="alert"><strong>We could not connect right now.</strong><p>Please try again in a moment. Nothing you entered has been lost.</p><a className="btn" href="/apply">Try again</a></div>;}
}

export default function Apply(props:{searchParams:Promise<{code?:string;edit?:string}>}) {
 return <main className="nd-apply">
  <header className="nd-apply-head">
   <span className="nd-apply-sun">☀</span>
   <div><strong>NayiDisha</strong><small>Jobs. Skills. Better Futures.</small></div>
  </header>
  <div className="nd-apply-intro">
   <h1>Find work near you.</h1>
   <p>Answer a few questions by voice or by typing. It takes about three minutes, and it is free.</p>
   <ul className="nd-apply-points">
    <li>Always free for job seekers</li>
    <li>You choose what is shared</li>
    <li>Speak in Marathi, Hindi or English</li>
   </ul>
  </div>
  <PhoneFrame><Suspense fallback={<div className="wa-msg wa-in" role="status">Starting your conversation…</div>}><ApplyContent {...props}/></Suspense></PhoneFrame>
  <footer className="nd-apply-foot">Demonstration build. Fictional data; no real messages are sent.</footer>
 </main>;
}
