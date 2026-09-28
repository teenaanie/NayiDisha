import {scopePage} from '@/lib/auth';
import {sql} from '@/lib/db';
import {fmtDateTime} from '@/lib/clock';
import {StatusPill} from '../../ui';
import {EmptyState} from '../../workspace-components';
import {InviteForm} from './invite-form';
export const dynamic='force-dynamic';

export default async function WhatsAppInvites(){
 await scopePage('ops');
 const [rows,[funnel]]=await Promise.all([
  sql`SELECT i.id,i.phone,i.token,i.status,i.language,i.sent_at,i.submitted_at,i.candidate_id,c.name,
       (SELECT r.filename FROM app.candidate_resume r WHERE r.candidate_id=i.candidate_id ORDER BY r.uploaded_at DESC LIMIT 1) resume
      FROM app.whatsapp_invite i LEFT JOIN app.candidate c ON c.id=i.candidate_id ORDER BY i.sent_at DESC, i.id DESC LIMIT 100`,
  sql`SELECT count(*)::int sent,count(*) FILTER (WHERE status IN ('ACCEPTED','FORM_SUBMITTED'))::int accepted,count(*) FILTER (WHERE status='DECLINED')::int declined,count(*) FILTER (WHERE status='FORM_SUBMITTED')::int registered FROM app.whatsapp_invite`,
 ]);
 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Self-registration</div><h1>WhatsApp invitations</h1><p>Invite people to register on WhatsApp. They reply yes, fill one form with their details and resume, and receive a sign-in link. In this demo the conversation runs in the simulator; no real message is sent.</p></div>
  <div className="grid g2 mb">
   <section className="card"><div className="card-head"><h2>Send invitations</h2></div><div className="card-body"><InviteForm/></div></section>
   <section className="card"><div className="card-head"><h2>Funnel</h2></div><div className="card-body"><div className="grid g2">
    {([['Invited',funnel.sent],['Said yes',funnel.accepted],['Declined',funnel.declined],['Registered',funnel.registered]] as const).map(([k,v])=><div className="field" key={k}><label>{k}</label><div><strong>{v}</strong></div></div>)}
   </div></div></section>
  </div>
  <section className="card"><div className="card-head"><h2>Recent invitations</h2></div>
   {rows.length===0?<div className="card-body"><EmptyState title="No invitations yet" description="Send one above to try the WhatsApp registration flow."/></div>:
   <div className="card-body tight"><div className="tblwrap"><table>
    <thead><tr><th>Mobile</th><th>Status</th><th>Sent</th><th>Candidate</th><th>Resume</th><th>Simulator</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}>
     <td className="mono">{r.phone}</td><td><StatusPill status={r.status}/></td><td className="small">{fmtDateTime(r.sent_at)}</td>
     <td>{r.candidate_id?<a href={'/ops/candidates/'+r.candidate_id}>{r.name||r.candidate_id}</a>:'—'}</td>
     <td className="small">{r.resume||'—'}</td>
     <td><a href={'/wa/invite/'+r.token} target="_blank" rel="noreferrer">Open chat</a></td>
    </tr>)}</tbody>
   </table></div></div>}
  </section>
 </main>;
}
