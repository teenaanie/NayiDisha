 'use server';
import {resetDemo} from '@/modules/demo';
import {requireRole,auditAction} from '@/lib/auth';
import {sql} from '@/lib/db';
import {now} from '@/lib/clock';
import {releaseMaturedHolds} from '@/modules/commercial';
import {sendDueInterviewReminders} from '@/modules/hiring';
import {revalidatePath} from 'next/cache';
export async function maintenance(f:FormData){
 await requireRole(['ADMIN']);const kind=String(f.get('kind'));
 if(kind==='reset')await resetDemo(String(f.get('confirmation')));
 else if(kind==='failures')await sql`UPDATE app.demo_clock SET messaging_failure=${f.has('messaging')},payout_failure=${f.has('payout')} WHERE id=1`;
 else if(kind==='run'){
 const at=await now();await sql`UPDATE app.job SET status='EXPIRED' WHERE status='LIVE' AND expires_at<=${at}`;
 await sql`UPDATE app.candidate_document SET object_ref=NULL WHERE object_ref IS NOT NULL AND created_at+retention_days*interval '1 day'<=${at}`;
 await releaseMaturedHolds();await sendDueInterviewReminders();
 await sql`UPDATE app.endorsement SET status='EXPIRED',raw_points=0 WHERE invite_expires_at IS NOT NULL AND invite_expires_at<=${at} AND status='PENDING'`;
 }else if(kind==='retry'){
 const [flags]=await sql`SELECT messaging_failure FROM app.demo_clock WHERE id=1`;if(flags.messaging_failure)throw new Error('Turn off simulated delivery failure before retrying.');
 await sql`UPDATE app.message_log m SET delivery_status='DELIVERED',attempts=attempts+1,failure_reason=NULL,cost_paise=CASE category WHEN 'MARKETING' THEN 86 WHEN 'UTILITY' THEN 12 WHEN 'AUTHENTICATION' THEN 12 ELSE 0 END WHERE delivery_status='FAILED' AND EXISTS(SELECT 1 FROM app.candidate c WHERE c.id=m.candidate_id AND c.status!='DELETED_BLOCKED') AND (category!='MARKETING' OR EXISTS(SELECT 1 FROM app.consent_record cr WHERE cr.candidate_id=m.candidate_id AND cr.purpose='JOB_ALERTS' AND cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL))`;
 }else throw new Error('Unknown control.');
 await auditAction('DEMO_'+kind,[]);revalidatePath('/','layout');
}
