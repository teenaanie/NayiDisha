import {PhoneFrame} from './phone-frame';
import {sql} from '@/lib/db';
import {identity} from '@/lib/auth';
import {readQuery} from '@/lib/read-query';
import {Suspense} from 'react';
import {SubNav,CANDIDATE_TABS} from '../subnav';
import {Simulator} from './simulator';
export const dynamic='force-dynamic';
async function JourneyData({searchParams}:{searchParams:Promise<{code?:string}>}){
 const {code}=await searchParams;const actor=await identity();
 // One database round trip avoids queueing five reads behind the serverless pool.
 const [data]=await readQuery(sql`SELECT
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT id,role_family_key,candidate_attributes FROM app.role_configuration WHERE status='PUBLISHED' ORDER BY id) x) AS configs,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT key,scope,data_type,display_name,translations,allowed_values FROM app.attribute_definition WHERE scope='CANDIDATE_ROLE') x) AS attributes,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT key,display_name FROM app.locality ORDER BY display_name) x) AS localities,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT j.id,j.title,j.shift,j.fixed_pay_paise,j.variable_max_paise FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id WHERE j.status='LIVE' AND e.status='VERIFIED' AND (j.expires_at IS NULL OR j.expires_at>(SELECT now_at FROM app.demo_clock WHERE id=1)) ORDER BY j.id) x) AS jobs,
 (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT c.*, EXISTS(SELECT 1 FROM app.assessment_attempt a WHERE a.candidate_id=c.id) AS has_assessment, EXISTS(SELECT 1 FROM app.consent_record r WHERE r.candidate_id=c.id AND r.purpose='PROCESSING' AND r.granted_at IS NOT NULL AND r.withdrawn_at IS NULL) AS has_consent FROM app.candidate c WHERE c.id=${actor?.role==='CANDIDATE'?actor.id:null}) x) AS profiles`);
 const {configs,attributes,localities,jobs,profiles}=data;

 const profile=profiles[0];
 if(profile?.status==='DELETED_BLOCKED')throw new Error('This profile is no longer active.');
 const step=!profile?'start':!profile.mobile_verified_at?'otp':!profile.has_consent?'consent':profile.status!=='PROFILE_ACTIVE'||!profile.name||!profile.role_config_id||!profile.work_authorised?'profile':!profile.has_assessment?'assess':'jobs';
 return <Simulator configs={configs} attributes={attributes} localities={localities} jobs={jobs} resume={step} existing={profiles[0]||null} source={code||''}/>;
}

async function JourneyContent(props:{searchParams:Promise<{code?:string}>}){
 try{return await JourneyData(props);}catch{return <div className="wa-msg wa-in" role="alert"><strong>We could not connect to your profile.</strong><p>The demo database may be busy. Your saved details have not been changed.</p><a className="btn" href="/wa">Try again</a> <a href="/sign-in">Sign in again</a></div>;}
}
export default function Journey(props:{searchParams:Promise<{code?:string}>}) {
 return <><SubNav tabs={CANDIDATE_TABS}/><main className="page"><div className="page-head"><h1>Candidate WhatsApp journey</h1><p>Follow the conversation from registration to finding a job.</p></div><PhoneFrame><Suspense fallback={<div className="wa-msg wa-in" role="status">Connecting to your demo profile…<p className="small">If the database does not respond, a retry option will appear.</p></div>}><JourneyContent {...props}/></Suspense></PhoneFrame></main></>;
}
