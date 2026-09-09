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
