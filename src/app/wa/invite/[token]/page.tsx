import {notFound} from 'next/navigation';
import {SubNav,CANDIDATE_TABS} from '../../../subnav';
import {PhoneFrame} from '../../phone-frame';
import {inviteByToken,inviteThread} from '@/modules/registration';
import {REGISTRATION_FLOW} from '@/modules/registration/flow';
import {InviteChat} from '../invite-client';
export const dynamic='force-dynamic';

export default async function Invite({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 const invite=await inviteByToken(token);
 if(!invite)notFound();
 const thread=(await inviteThread(invite.id)).map(m=>({direction:m.direction,body:m.body,template:m.template_key,at:new Date(m.created_at).toISOString()}));
 return <><SubNav tabs={CANDIDATE_TABS}/><main className="page">
  <div className="nd-journey-intro"><div className="nd-section-kicker">WhatsApp self-registration</div><h1>Register without leaving WhatsApp.</h1><p>This is what {invite.phone} sees after Operations sends an invitation. Reply, fill one form, and you are registered.</p></div>
  <PhoneFrame greeting={false} composer={invite.status==='FORM_SUBMITTED'?'Tap the link to sign in':'Tap a reply above'}>
   <InviteChat token={token} status={invite.status} language={invite.language} thread={thread} flow={REGISTRATION_FLOW}/>
  </PhoneFrame>
 </main></>;
}
