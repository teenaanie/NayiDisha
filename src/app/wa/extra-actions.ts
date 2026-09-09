 'use server';
import {sql} from '@/lib/db';
import {requireRole,auditAction} from '@/lib/auth';
import {nextId} from '@/lib/ids';
import {now} from '@/lib/clock';
import {text,choice} from '@/lib/validation';
import {createEndorsementInvite} from '@/modules/lifecycle';
import {withdrawConsent} from '@/modules/candidate';
import {revalidatePath} from 'next/cache';
export async function extra(f:FormData){
 const actor=await requireRole(['CANDIDATE']);const kind=String(f.get('kind'));
 if(kind==='achievement')await sql`INSERT INTO app.achievement(id,candidate_id,category,description,created_at) VALUES(${await nextId('ACH')},${actor.id},${choice(String(f.get('category')),['SALES_TARGET','CUSTOMER_RECOGNITION','CERTIFICATION','RELIABILITY','TEAM_CONTRIBUTION'],'category')},${text(f.get('description'),'Description')},${await now()})`;
 else if(kind==='invite'){const result=await createEndorsementInvite(actor.id,text(f.get('name'),'Endorser name'),text(f.get('contact'),'Demo contact'),choice(String(f.get('relationship')),['FORMER_MANAGER','SENIOR_COLLEAGUE','EXPERIENCED_COLLEAGUE','PEER'],'relationship'));return '/endorse/'+result.token;}
 else if(kind==='withdraw')await withdrawConsent(actor.id,choice(String(f.get('purpose')),['PROCESSING','PARTNER_ASSISTANCE','JOB_ALERTS'],'purpose'));
 await auditAction(kind,[actor.id]);revalidatePath('/wa','layout');return 'Saved';
}
