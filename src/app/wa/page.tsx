import {sql} from '@/lib/db';
import {identity} from '@/lib/auth';
import {resumePoint} from '@/modules/lifecycle';
import {Simulator} from './simulator';
export const dynamic='force-dynamic';
export default async function Journey({searchParams}:{searchParams:Promise<{code?:string}>}){
 const {code}=await searchParams;const actor=await identity();
 const [configs,attributes,localities,jobs,profiles]=await Promise.all([sql`SELECT id,role_family_key,candidate_attributes FROM app.role_configuration WHERE status='PUBLISHED'`,sql`SELECT key,scope,data_type,display_name,translations,allowed_values FROM app.attribute_definition`,sql`SELECT key,display_name FROM app.locality ORDER BY display_name`,sql`SELECT j.id,j.title,j.shift,j.fixed_pay_paise,j.variable_max_paise FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id WHERE j.status='LIVE' AND e.status='VERIFIED' AND (j.expires_at IS NULL OR j.expires_at>(SELECT now_at FROM app.demo_clock WHERE id=1))`,actor?.role==='CANDIDATE'?sql`SELECT * FROM app.candidate WHERE id=${actor.id}`:Promise.resolve([])]);
 return <main className="page"><Simulator configs={configs} attributes={attributes} localities={localities} jobs={jobs} resume={profiles[0]?(await resumePoint(profiles[0].id)).step:'start'} existing={profiles[0]||null} source={code||''}/></main>;
}
