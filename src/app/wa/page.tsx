import {sql} from '@/lib/db';
import {identity} from '@/lib/auth';
import {readQuery} from '@/lib/read-query';
import {Suspense} from 'react';
import {SubNav,CANDIDATE_TABS} from '../subnav';
import {Simulator} from './simulator';
export const dynamic='force-dynamic';
async function JourneyContent({searchParams}:{searchParams:Promise<{code?:string}>}){
 const {code}=await searchParams;const actor=await identity();
 const [configs,attributes,localities,jobs,profiles]=await Promise.all([readQuery(sql`SELECT id,role_family_key,candidate_attributes FROM app.role_configuration WHERE status='PUBLISHED'`),readQuery(sql`SELECT key,scope,data_type,display_name,translations,allowed_values FROM app.attribute_definition`),readQuery(sql`SELECT key,display_name FROM app.locality ORDER BY display_name`),readQuery(sql`SELECT j.id,j.title,j.shift,j.fixed_pay_paise,j.variable_max_paise FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id WHERE j.status='LIVE' AND e.status='VERIFIED' AND (j.expires_at IS NULL OR j.expires_at>(SELECT now_at FROM app.demo_clock WHERE id=1))`),actor?.role==='CANDIDATE'?readQuery(sql`SELECT c.*, EXISTS(SELECT 1 FROM app.assessment_attempt a WHERE a.candidate_id=c.id) AS has_assessment, EXISTS(SELECT 1 FROM app.consent_record r WHERE r.candidate_id=c.id AND r.purpose='PROCESSING' AND r.granted_at IS NOT NULL AND r.withdrawn_at IS NULL) AS has_consent FROM app.candidate c WHERE c.id=${actor.id}`):Promise.resolve([])]);
 const profile=profiles[0];
 if(profile?.status==='DELETED_BLOCKED')throw new Error('This profile is no longer active.');
 const step=!profile?'start':!profile.mobile_verified_at?'otp':!profile.has_consent?'consent':profile.status!=='PROFILE_ACTIVE'||!profile.name||!profile.role_config_id||!profile.work_authorised?'profile':!profile.has_assessment?'assess':'jobs';
 return <main className="page"><Simulator configs={configs} attributes={attributes} localities={localities} jobs={jobs} resume={step} existing={profiles[0]||null} source={code||''}/></main>;
}

export default function Journey(props:{searchParams:Promise<{code?:string}>}) {
 return <><SubNav tabs={CANDIDATE_TABS}/><Suspense fallback={<main className="page" role="status"><h1>Candidate journey</h1><p>Loading your profile and available roles…</p></main>}><JourneyContent {...props}/></Suspense></>;
}
