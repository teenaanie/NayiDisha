 'use server';
import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId, randomToken } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import { text, integer, choice } from '@/lib/validation';
import { requireRole } from '@/lib/auth';
const value=(f:FormData,k:string)=>String(f.get(k)??'').trim();
const list=(f:FormData,k:string)=>f.getAll(k).map(String);
export async function manage(f:FormData){
 const actor=await requireRole(['ADMIN','OPERATIONS']);
 const kind=value(f,'kind'),id=value(f,'id'),at=await now();
 await sql.begin(async tx=>{
 if(kind==='role_rules'){
 const direct=value(f,'direct').split(',').map(s=>s.trim()).filter(Boolean),adjacent=value(f,'adjacent').split(',').map(s=>s.trim()).filter(Boolean);
 const mapping=JSON.parse(value(f,'mapping')||'{}');if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||Object.values(mapping).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string')))throw new Error('Skill mapping must map skill names to lists of tags.');
 await tx`UPDATE app.role_family SET direct_tags=${tx.json(direct)},transferable=${tx.json(adjacent)},skill_mapping=${tx.json(mapping)} WHERE key=${id}`;
 }else if(kind==='site_edit'){
 await tx`UPDATE app.partner_site SET name=${text(value(f,'name'),'Site name')},address=${text(value(f,'address'),'Address')},locality_key=${value(f,'locality')} WHERE id=${id}`;
 }else if(kind==='fraud'){
 const reason=text(value(f,'reason'),'Decision reason');const [fcase]=await tx`SELECT * FROM app.fraud_case WHERE id=${id} AND status='OPEN' FOR UPDATE`;if(!fcase)throw new Error('Case is not open.');
 const decision=choice(value(f,'decision'),['DISMISSED','CONFIRMED','CORRECT_SOURCE'],'Decision');
 if(decision==='CORRECT_SOURCE'){
 if(fcase.signal!=='SOURCE_CORRECTION_REQUEST')throw new Error('No source correction was requested.');
 const [used]=await tx`SELECT id FROM app.qualified_lead_unlock WHERE candidate_id=${fcase.detail.candidateId}`;if(used)throw new Error('A profile was already unlocked; review existing rewards before correcting attribution.');
 const [site]=await tx`SELECT s.* FROM app.partner_site s JOIN app.partner p ON p.id=s.partner_id WHERE s.id=${fcase.detail.siteId} AND s.status='ACTIVE' AND p.status='VERIFIED'`;if(!site)throw new Error('The requested source is not active.');
 await tx`UPDATE app.attribution SET partner_site_id=${site.id},partner_id=${site.partner_id},method='MANUAL_CORRECTION',status='ACTIVE',status_reason=${reason} WHERE id=${fcase.subject_id}`;
 }else if(fcase.subject_type==='attribution')await tx`UPDATE app.attribution SET status=${decision==='CONFIRMED'?'VOID':'ACTIVE'},status_reason=${reason} WHERE id=${fcase.subject_id}`;
 await tx`UPDATE app.fraud_case SET status='RESOLVED',resolution=${decision+': '+reason} WHERE id=${id}`;
 }else if(kind==='locality'){
  const key=text(value(f,'key'),'Locality key').toLowerCase().replace(/[^a-z0-9_]/g,'_');
  const lat=Number(value(f,'lat')),lng=Number(value(f,'lng'));
  if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180) throw new Error('Enter valid map coordinates.');
  await tx`INSERT INTO app.locality(key,display_name,city,lat,lng) VALUES(${key},${text(value(f,'name'),'Name')},${text(value(f,'city'),'City')},${lat},${lng})`;
 } else if(kind==='employer'){
  await tx`UPDATE app.employer_organisation SET legal_name=${text(value(f,'legal_name'),'Legal name')},brand_name=${text(value(f,'brand_name'),'Brand')},gst_pan=${value(f,'gst_pan')||null},billing_contact=${value(f,'billing_contact')||null} WHERE id=${id}`;
 } else if(kind==='partner'){
  const capabilities=list(f,'capabilities'),localities=list(f,'localities');
  if(!capabilities.length||!localities.length) throw new Error('Choose at least one capability and service locality.');
  const roles=await tx`SELECT industry_key||'/'||key AS key FROM app.role_family`;
  const locs=await tx`SELECT key FROM app.locality`;
  if(capabilities.some(v=>!roles.some(r=>r.key===v))||localities.some(v=>!locs.some(r=>r.key===v)))throw new Error('Unknown capability or locality.');
  await tx`UPDATE app.partner SET name=${text(value(f,'name'),'Partner name')},pan=${value(f,'pan')||null},payout_upi=${value(f,'payout_upi')||null},capabilities=${tx.json(capabilities)},service_localities=${tx.json(localities)} WHERE id=${id}`;
 } else if(kind==='site'){
  const [p]=await tx`SELECT id FROM app.partner WHERE id=${id}`;if(!p)throw new Error('Partner not found.');
  const siteId=await nextId('SITE',tx),token=randomToken(24),code='S'+randomToken(8).toUpperCase();
  await tx`INSERT INTO app.partner_site(id,partner_id,locality_key,partner_code,qr_token,status,created_at,name,address) VALUES(${siteId},${id},${value(f,'locality')},${code},${'qr_'+token},'SUSPENDED',${at},${text(value(f,'name'),'Site name')},${text(value(f,'address'),'Address')})`;
 } else if(kind==='site_status'){
  const status=choice(value(f,'status'),['ACTIVE','SUSPENDED','REVOKED'],'site status');
  await tx`UPDATE app.partner_site SET status=${status},suspended_by_partner=false WHERE id=${id}`;
 } else if(kind==='industry'){
  const key=text(value(f,'key'),'Industry key').toUpperCase().replace(/[^A-Z0-9_]/g,'_');
  await tx`INSERT INTO app.industry(key,display_name,translations,created_at) VALUES(${key},${text(value(f,'name'),'Name')},${tx.json({en:value(f,'name'),hi:value(f,'hi'),mr:value(f,'mr')})},${at})`;
 } else if(kind==='role'){
  const key=text(value(f,'key'),'Role key').toUpperCase().replace(/[^A-Z0-9_]/g,'_');
  await tx`INSERT INTO app.role_family(key,industry_key,display_name,transferable,created_at) VALUES(${key},${value(f,'industry')},${text(value(f,'name'),'Role name')},${tx.json(value(f,'skills').split(',').map(s=>s.trim()).filter(Boolean))},${at})`;
  const template=value(f,'template');
  await tx`INSERT INTO app.role_configuration(id,industry_key,role_family_key,version,status,candidate_attributes,job_attributes,critical_skills,qualification_rules,scoring_weights,endorsement_cap,assessment_template_id,assessment_threshold,preview_fields,unlock_fields,document_checklist,created_at)
  SELECT ${'CFG-'+key+'-'+randomToken(6)},${value(f,'industry')},${key},'1.0','DRAFT',candidate_attributes,job_attributes,${tx.json(value(f,'skills').split(',').map(s=>s.trim()).filter(Boolean))},qualification_rules,scoring_weights,endorsement_cap,NULL,assessment_threshold,preview_fields,unlock_fields,document_checklist,${at} FROM app.role_configuration WHERE id=${template}`;
 } else if(kind==='attribute'){
  const key=text(value(f,'key'),'Field key').toLowerCase().replace(/[^a-z0-9_]/g,'_');
  const type=choice(value(f,'type'),['TEXT','INT','BOOL','ENUM'],'field type');
  await tx`INSERT INTO app.attribute_definition(key,scope,data_type,display_name,allowed_values,translations,freshness_days,created_at) VALUES(${key},${choice(value(f,'scope'),['CANDIDATE_ROLE','JOB'],'scope')},${type},${text(value(f,'name'),'Field label')},${tx.json(value(f,'options').split(',').map(s=>s.trim()).filter(Boolean))},${tx.json({en:value(f,'name'),hi:value(f,'hi'),mr:value(f,'mr')})},${Number(value(f,'freshness'))||null},${at})`;
 } else if(kind==='clone'){
  const version=text(value(f,'version'),'Version');
  await tx`INSERT INTO app.role_configuration(id,industry_key,role_family_key,version,status,candidate_attributes,job_attributes,critical_skills,qualification_rules,scoring_weights,endorsement_cap,assessment_template_id,assessment_threshold,preview_fields,unlock_fields,document_checklist,created_at)
  SELECT ${'CFG-'+randomToken(12)},industry_key,role_family_key,${version},'DRAFT',candidate_attributes,job_attributes,critical_skills,qualification_rules,scoring_weights,endorsement_cap,assessment_template_id,assessment_threshold,preview_fields,unlock_fields,document_checklist,${at} FROM app.role_configuration WHERE id=${id}`;
 } else if(kind==='config'){
  const [cfg]=await tx`SELECT * FROM app.role_configuration WHERE id=${id} FOR UPDATE`;
  if(!cfg || !['DRAFT','SANDBOX','REVIEW'].includes(cfg.status))throw new Error('Create a new version before changing a published role.');
  const required=list(f,'required'),fields=list(f,'fields'),jobFields=list(f,'job_fields'),jobRequired=list(f,'job_required');
  const weights:Record<string,number>={};for(const key of Object.keys(cfg.scoring_weights))weights[key]=integer(Number(value(f,'weight_'+key)),key,0,100);
  if(Object.values(weights).reduce((a,b)=>a+b,0)!==100)throw new Error('Weights must total 100.');
  const threshold=integer(Number(value(f,'threshold')),'Assessment threshold',0,100);
  const tpl='AST-'+randomToken(16),questions=[];
  for(let i=1;i<=5;i++){
   const prompt=value(f,'q'+i);if(!prompt)continue;
   const options=value(f,'o'+i).split('|').map(s=>s.trim()).filter(Boolean),answer=value(f,'a'+i);
   if(options.length<2||!options.includes(answer))throw new Error('Each question needs at least two choices and an answer matching one choice.');
   const hiOptions=value(f,'oh'+i).split('|').map(s=>s.trim()),mrOptions=value(f,'om'+i).split('|').map(s=>s.trim());
   if(!value(f,'hi'+i)||!value(f,'mr'+i)||hiOptions.length!==options.length||mrOptions.length!==options.length||hiOptions.some(s=>!s)||mrOptions.some(s=>!s))throw new Error('Provide Hindi and Marathi questions and the same number of translated choices.');
   questions.push({optionTranslations:{hi:hiOptions,mr:mrOptions},id:'q'+i,prompt,options,answer,marks:1,translations:{en:prompt,hi:value(f,'hi'+i),mr:value(f,'mr'+i)}});
  }
  if(questions.length){await tx`INSERT INTO app.assessment_template(id,industry_key,role_family_key,version,questions,pass_threshold,time_limit_sec,languages,status,created_at) VALUES(${tpl},${cfg.industry_key},${cfg.role_family_key},${randomToken(8)},${tx.json(questions)},${threshold},900,${tx.json(['en','hi','mr'])},'PUBLISHED',${at})`;}
  await tx`UPDATE app.role_configuration SET job_attributes=${tx.json(jobFields.map(key=>({key,required:jobRequired.includes(key)})))},document_checklist=${tx.json(value(f,'documents').split(',').map(s=>s.trim()).filter(Boolean))},candidate_attributes=${tx.json(fields.map(key=>({key,required:required.includes(key)})))},scoring_weights=${tx.json(weights)},assessment_threshold=${threshold},qualification_rules=jsonb_set(qualification_rules,'{minAssessmentScore}',${String(threshold)}::jsonb),assessment_template_id=${questions.length?tpl:cfg.assessment_template_id},status='REVIEW' WHERE id=${id}`;
 } else if(kind==='commercial'){
  await tx`UPDATE app.commercial_policy SET active=false WHERE active`;
  const [old]=await tx`SELECT * FROM app.commercial_policy ORDER BY created_at DESC LIMIT 1`;
  const copy={...old,id:'POL-'+randomToken(12),version:at.toISOString(),active:true,created_at:at,
    partner_reward_paise:integer(Number(value(f,'reward')),'Reward',0,100000)*100,
    partner_payout_minimum_paise:integer(Number(value(f,'minimum')),'Minimum',0,100000)*100,
    additional_credit_paise:integer(Number(value(f,'price')),'Unlock price',0,100000)*100,
    salary_basis:choice(value(f,'salary'),['TOTAL','FIXED'],'salary basis'),endorsement_cap:integer(Number(value(f,'cap')),'Endorsement cap',0,10)};
  await tx`INSERT INTO app.commercial_policy ${tx(copy)}`;
 } else throw new Error('Unknown action.');
 await tx`INSERT INTO app.action_audit(actor,role,action,entity_id,detail) VALUES(${actor.id},${actor.role},${kind},${id||null},${tx.json({reason:value(f,'reason')||'Operations maintenance'})})`;
 });
 revalidatePath('/','layout');
}
