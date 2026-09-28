'use server';
import {requireRole,auditAction} from '@/lib/auth';
import {choice} from '@/lib/validation';
import {sendInvites} from '@/modules/registration';

export async function inviteCandidates(phones:string,language:string){
 const actor=await requireRole(['ADMIN','OPERATIONS']);
 const lang=choice(language,['en','hi','mr'] as const,'language');
 const list=phones.split(/[\n,;]+/).map(p=>p.trim()).filter(Boolean);
 if(!list.length)return {error:'Enter at least one demo mobile number.',results:[]};
 const results=await sendInvites(actor.id,list,lang);
 await auditAction('WHATSAPP_INVITES_SENT',[]);
 return {results};
}
