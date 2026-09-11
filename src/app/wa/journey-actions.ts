 'use server';
import {after} from 'next/server';
import {safelyRefreshCandidate} from '@/modules/discovery';
import {sql} from '@/lib/db';
import {identity,setIdentity,requireRole,auditAction} from '@/lib/auth';
import {startRegistration,verifyAndBind,grantConsent,withdrawConsent,completeProfile,apply,reconfirmInterest,recordAssessment,sendTemplate} from '@/modules/candidate';
import {resumePoint,raiseDataRequest} from '@/modules/lifecycle';
import {getRoleConfig} from '@/modules/configuration';
import {recordMatch} from '@/modules/matching';
import {nextId,randomToken} from '@/lib/ids';
import {now} from '@/lib/clock';
import {text,integer,choice} from '@/lib/validation';
async function candidate(){return requireRole(['CANDIDATE']);}
export async function start(phone:string,language:'en'|'hi'|'mr',code:string){
 if(!/^\+910000[0-9]{6}$/.test(phone))throw new Error('Use a non-routable demo number such as +910000000042.');
 choice(language,['en','hi','mr'],'language');
 const reg=await startRegistration({phone,language,siteCode:code||null,method:code.startsWith('qr_')?'QR':code?'PARTNER_CODE':'DIRECT'});
 await setIdentity(reg.candidateId,'REGISTRATION');
 return {id:reg.candidateId};
}
export async function verify(code:string){
 const actor=await requireRole(['REGISTRATION']);
 if(code!=='123456'){await sql`INSERT INTO app.workflow_issue(id,candidate_id,kind,detail) VALUES(${await nextId('ISS')},${actor.id},'OTP_FAILED','Incorrect simulated verification code')`;throw new Error('The demo verification code is 123456.');}
 const [c]=await sql`SELECT pending_source FROM app.candidate WHERE id=${actor.id}`;
 await verifyAndBind(actor.id,c.pending_source?.siteId?c.pending_source:null);
 await setIdentity(actor.id,'CANDIDATE');
 const state=await resumePoint(actor.id);return state;
}
export async function saveConsent(processing:boolean,alerts:boolean,assistance:boolean){
 const c=await candidate();if(!processing)throw new Error('Processing consent is needed to match you with jobs. You can leave without continuing.');
 for(const [purpose,selected] of [['PROCESSING',processing],['JOB_ALERTS',alerts],['PARTNER_ASSISTANCE',assistance]] as const){if(selected)await grantConsent(c.id,purpose);else await withdrawConsent(c.id,purpose);}
 await auditAction('CONSENT_CHOICES_SAVED',[c.id]);
}
export async function saveProfile(input:{education?:string;name:string;locality:string;age18:boolean;work:boolean;months:number;tags:string;languages:string[];pay:number;commute:number;shifts:string[];config:string;attributes:Record<string,string>}){
 const c=await candidate();
 if(!input.age18){await sql`UPDATE app.candidate SET name=NULL,locality_key=NULL,experience_tags='[]',languages='[]',current_pay_paise=NULL,expected_pay_paise=NULL,status='DELETED_BLOCKED' WHERE id=${c.id}`;throw new Error('This demo is for people aged 18 or above. Unnecessary profile details have been removed.');}
 const cfg=await getRoleConfig(input.config);if(cfg.status!=='PUBLISHED')throw new Error('Select a published role.');
 const defs=await sql`SELECT * FROM app.attribute_definition WHERE key=ANY(${cfg.candidateAttributes.map(a=>a.key)}) AND scope='CANDIDATE_ROLE'`;
 for(const d of defs){const value=input.attributes[d.key];if(cfg.candidateAttributes.find(a=>a.key===d.key)?.required&&!value)throw new Error(d.display_name+' is required.');if(value && d.data_type==='ENUM'&&!d.allowed_values.includes(value))throw new Error('Invalid '+d.display_name);if(value && d.data_type==='BOOL'&&!['true','false'].includes(value))throw new Error('Invalid '+d.display_name);if(value && d.data_type==='INT')integer(Number(value),d.display_name);}
 integer(input.months,'Experience',0,900);integer(input.pay,'Expected pay',0,1000000);integer(input.commute,'Commute',1,240);
 if(!input.shifts.length||!input.languages.length)throw new Error('Choose languages and availability.');
 await completeProfile(c.id,{name:text(input.name,'Name'),localityKey:input.locality,age18:input.age18,workAuthorised:input.work,experienceMonths:input.months,experienceTags:input.tags.split(',').map(s=>s.trim()).filter(Boolean),languages:input.languages,currentPayPaise:null,expectedPayPaise:input.pay*100,maxCommuteMin:input.commute,shiftAvailability:input.shifts});
 await sql`UPDATE app.candidate SET education=${input.education||''},role_config_id=${cfg.id} WHERE id=${c.id}`;
 const at=await now();for(const d of defs){const v=input.attributes[d.key];if(!v)continue;
 await sql`INSERT INTO app.candidate_attribute_value(id,candidate_id,attribute_key,role_config_id,value_text,value_bool,value_int,collected_at) VALUES(${await nextId('ATV')},${c.id},${d.key},${cfg.id},${['BOOL','INT'].includes(d.data_type)?null:v},${d.data_type==='BOOL'?v==='true':null},${d.data_type==='INT'?Number(v):null},${at}) ON CONFLICT(candidate_id,attribute_key) DO UPDATE SET role_config_id=EXCLUDED.role_config_id,value_text=EXCLUDED.value_text,value_bool=EXCLUDED.value_bool,value_int=EXCLUDED.value_int,collected_at=EXCLUDED.collected_at`;
 }
 await auditAction('PROFILE_SAVED',[c.id]);after(()=>safelyRefreshCandidate(c.id));
}
export async function beginTest(){
 const c=await candidate();const [profile]=await sql`SELECT role_config_id,language FROM app.candidate WHERE id=${c.id}`;
 const cfg=await getRoleConfig(profile.role_config_id);const [tpl]=await sql`SELECT * FROM app.assessment_template WHERE id=${cfg.assessmentTemplateId}`;
 if(!tpl)throw new Error('This role needs a published assessment.');
 const at=new Date();const demoAt=await now();const attempts=await sql`SELECT completed_at FROM app.assessment_attempt WHERE candidate_id=${c.id} AND template_id=${tpl.id} ORDER BY completed_at DESC`;
 if(attempts.length>=tpl.max_attempts)throw new Error('Attempt limit reached. Contact Operations.');
 if(attempts[0]&&new Date(attempts[0].completed_at).getTime()+tpl.retake_hours*3600000>demoAt.getTime())throw new Error('Please wait '+tpl.retake_hours+' hours before retaking this test.');
 const questions=[...tpl.questions].sort((a,b)=>a.id.localeCompare(b.id));
 // Session-bound shuffled order; answer keys never leave the server.
 const salt=randomToken(12);questions.sort((a,b)=>(a.id+salt).split('').reduce((n,x)=>n+x.charCodeAt(0),0)%7-(b.id+salt).split('').reduce((n,x)=>n+x.charCodeAt(0),0)%7);
 const id=randomToken(24),expires=new Date(at.getTime()+(tpl.time_limit_sec||900)*1000);
 await sql`INSERT INTO app.assessment_session(id,candidate_id,template_id,template_version,language,question_ids,started_at,expires_at) VALUES(${id},${c.id},${tpl.id},${tpl.version},${profile.language},${sql.json(questions.map(q=>q.id))},${at},${expires})`;
 return {id,minutes:(tpl.time_limit_sec||900)/60,questions:questions.map(q=>({id:q.id,prompt:q.translations?.[profile.language]||q.prompt,options:q.options.map((value:string,i:number)=>({value,label:q.optionTranslations?.[profile.language]?.[i]||value}))}))};
}
export async function submitTest(id:string,answers:Record<string,string>){
 const c=await candidate();const at=new Date();
 return sql.begin(async tx=>{
 await tx`SELECT id FROM app.candidate WHERE id=${c.id} FOR UPDATE`;
 const [session]=await tx`UPDATE app.assessment_session SET completed_at=${at} WHERE id=${id} AND candidate_id=${c.id} AND completed_at IS NULL AND expires_at>=${at} RETURNING *`;
 if(!session)throw new Error('Test expired or was already submitted.');
 const [template]=await tx`SELECT max_attempts,retake_hours FROM app.assessment_template WHERE id=${session.template_id}`;
 const attempts=await tx`SELECT completed_at FROM app.assessment_attempt WHERE candidate_id=${c.id} AND template_id=${session.template_id} ORDER BY completed_at DESC`;
 const demoAt=await now(tx);
 if(attempts.length>=template.max_attempts||(attempts[0]&&new Date(attempts[0].completed_at).getTime()+template.retake_hours*3600000>demoAt.getTime()))throw new Error('Attempt limit or retake waiting period reached.');
 const result=await recordAssessment(c.id,session.template_id,answers,tx);
 await tx`UPDATE app.assessment_attempt SET started_at=${session.started_at} WHERE id=${result.id}`;
 after(()=>safelyRefreshCandidate(c.id));return result;});
}
export async function applyJob(jobId:string){const c=await candidate();const result=await apply(c.id,jobId);await sendTemplate(c.id,'reconfirm_interest',{employer:'the employer',title:jobId});return result;}
export async function confirm(applicationId:string){const c=await candidate();const [app]=await sql`SELECT job_id FROM app.application WHERE id=${applicationId} AND candidate_id=${c.id}`;if(!app)throw new Error('Application not found.');await reconfirmInterest(applicationId,true);const result=await recordMatch(applicationId,c.id,app.job_id);return result.computation;}
export async function correctSource(code:string,reason:string){const c=await candidate();const [applied]=await sql`SELECT id FROM app.application WHERE candidate_id=${c.id} LIMIT 1`;if(applied)throw new Error('After applying, ask Operations to review the source.');const [site]=await sql`SELECT id,partner_id FROM app.partner_site WHERE partner_code=${code}`;if(!site)throw new Error('Code not found.');const [attribution]=await sql`SELECT id FROM app.attribution WHERE candidate_id=${c.id}`;if(!attribution)throw new Error('No source is recorded. Ask Operations to review your registration.');await sql`UPDATE app.attribution SET status='UNDER_REVIEW',status_reason=${text(reason,'Reason')} WHERE candidate_id=${c.id}`;await sql`INSERT INTO app.fraud_case(id,subject_type,subject_id,signal,detail,status,created_at) SELECT ${await nextId('FRD')},'attribution',id,'SOURCE_CORRECTION_REQUEST',${sql.json({candidateId:c.id,siteId:site.id,partnerId:site.partner_id,reason})},'OPEN',${await now()} FROM app.attribution WHERE candidate_id=${c.id}`;}
