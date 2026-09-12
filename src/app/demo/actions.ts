 'use server';
import {setIdentity,identity} from '@/lib/auth';
import {redirect} from 'next/navigation';
import {sql} from '@/lib/db';
export async function login(f:FormData){
 const expected=process.env.DEMO_PASSWORD||(process.env.NODE_ENV!=='production'?'demo-admin':'');
 if(!expected||String(f.get('password'))!==expected)redirect('/demo?error=Incorrect+password');
 await setIdentity('ADMIN-001','ADMIN');await setIdentity('ADMIN-001','ADMIN','nd_admin');redirect('/');
}
export async function switchPersona(f:FormData){
 const admin=await identity('nd_admin');if(admin?.role!=='ADMIN')throw new Error('Only the demo administrator can switch identities.');
 const [role,id]=String(f.get('persona')).split(':');
 const destination:Record<string,string>={ADMIN:'/',OPERATIONS:'/ops',FINANCE:'/finance',EMPLOYER:'/employer',PARTNER:'/partner',CANDIDATE:'/wa/inbox'};
 if(!destination[role])throw new Error('Unknown role.');
 const tables:Record<string,string>={EMPLOYER:'employer_organisation',PARTNER:'partner',CANDIDATE:'candidate'};
 if(tables[role]&&!(await sql.unsafe('SELECT id FROM app.'+tables[role]+' WHERE id=$1',[id])).length)throw new Error('Unknown identity.');
 await setIdentity(id,role as any);redirect(destination[role]);
}

/**
 * Candidates are self-service and unbounded (every completed WhatsApp journey
 * adds one), so — unlike the small, curated employer/partner/operations lists
 * above — they are looked up by id or phone rather than offered as a list.
 */
export async function findCandidate(f:FormData){
 const admin=await identity('nd_admin');if(admin?.role!=='ADMIN')throw new Error('Only the demo administrator can switch identities.');
 const query=String(f.get('candidate')||'').trim();
 if(!query)redirect('/demo?error='+encodeURIComponent('Enter a candidate ID or phone number.'));
 const [row]=await sql<{id:string}[]>`SELECT id FROM app.candidate WHERE id=${query} OR phone=${query} LIMIT 1`;
 if(!row)redirect('/demo?error='+encodeURIComponent('No candidate found for "'+query+'".'));
 await setIdentity(row.id,'CANDIDATE');redirect('/wa/inbox');
}
