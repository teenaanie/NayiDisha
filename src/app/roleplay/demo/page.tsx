import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { identity } from '@/lib/auth';
import { syntheticAccounts, actAsCookie } from '@/modules/roleplay/service/auth';
import { withActor, WhoAmI } from '../shared';
export const dynamic = 'force-dynamic';

async function actAs(form: FormData) {
  'use server';
  const who = await identity();
  if (who?.role !== 'ADMIN') throw new Error('Only the demo administrator can switch practice accounts.');
  const c = await cookies();
  const v = String(form.get('account') ?? '');
  if (!v) c.delete('rp_act_as');
  else { const [tenant, subject] = v.split('|'); c.set('rp_act_as', actAsCookie(tenant, subject), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 3600 }); }
  redirect('/roleplay');
}

export default async function Demo() {
  const who = await identity();
  const actor = await withActor();
  if (who?.role !== 'ADMIN') return <main className="page"><h1>Demo accounts</h1><p>Sign in as the demo administrator to switch between synthetic practice accounts. Candidates use their own account automatically.</p>{actor && <WhoAmI actor={actor} />}</main>;
  const accounts = await syntheticAccounts();
  return <main className="page">
    <div className="page-head"><h1>Demo accounts</h1><p>Synthetic, fictional accounts for exercising roles and tenant isolation. In production this switcher does not exist; identity comes from single sign-on.</p></div>
    {actor && <WhoAmI actor={actor} />}
    <form action={actAs} className="card"><div className="card-body">
      {accounts.map((a) => <label key={a.tenant + a.subject} className="field"><input type="radio" name="account" value={`${a.tenant}|${a.subject}`} defaultChecked={actor?.subject === a.subject} /> <strong>{a.display_name}</strong> <span className="small muted">{a.tenant} · {a.roles.join(', ')}</span></label>)}
      <label className="field"><input type="radio" name="account" value="" /> Back to the demo administrator</label>
      <button className="btn btn-primary">Switch</button>
    </div></form>
  </main>;
}
