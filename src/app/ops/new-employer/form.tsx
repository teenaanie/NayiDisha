'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actCreateEmployer } from '../../actions';

export function NewEmployerForm({ localities }: { localities: { key: string; display_name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [f, setF] = useState({
    legalName: '',
    brandName: '',
    gstPan: '',
    billingContact: '',
    locationName: '',
    localityKey: 'deccan',
    hours: '09:00-19:00',
    adminName: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const valid = f.legalName.trim() && f.brandName.trim() && f.locationName.trim() && f.adminName.trim();

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="card-body">
        <p className="small muted">
          Enter the employer and first branch details. Use synthetic details in this demo.
        </p>

        <h3 style={{ marginTop: 18, marginBottom: 10 }}>Organisation</h3>
        <div className="field">
          <label htmlFor="ln">Legal entity name</label>
          <input id="ln" value={f.legalName} onChange={set('legalName')} />
        </div>
        <div className="field">
          <label htmlFor="bn">Brand name (what candidates see)</label>
          <input id="bn" value={f.brandName} onChange={set('brandName')} />
        </div>
        <div className="grid g2">
          <div className="field">
            <label htmlFor="gp">GST / PAN</label>
            <input id="gp" value={f.gstPan} onChange={set('gstPan')} />
          </div>
          <div className="field">
            <label htmlFor="bc">Billing contact</label>
            <input id="bc" value={f.billingContact} onChange={set('billingContact')} />
          </div>
        </div>

        <h3 style={{ marginTop: 18, marginBottom: 10 }}>First branch</h3>
        <p className="small muted" style={{ marginBottom: 12 }}>
          An employer needs somewhere to hire before it can post a job. Its map point comes from the
          locality, which is what the commute estimate is measured against.
        </p>
        <div className="grid g3">
          <div className="field">
            <label htmlFor="lcn">Branch name</label>
            <input id="lcn" value={f.locationName} onChange={set('locationName')} />
          </div>
          <div className="field">
            <label htmlFor="lk">Locality</label>
            <select id="lk" value={f.localityKey} onChange={set('localityKey')}>
              {localities.map((l) => <option key={l.key} value={l.key}>{l.display_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hr">Operating hours</label>
            <input id="hr" value={f.hours} onChange={set('hours')} />
          </div>
        </div>

        <h3 style={{ marginTop: 18, marginBottom: 10 }}>Company administrator</h3>
        <div className="field">
          <label htmlFor="an">Name</label>
          <input id="an" value={f.adminName} onChange={set('adminName')} />
        </div>

        <div className="note warn small mt">
          The employer is created as <strong>pending review</strong>. Verification is a separate,
          audited act, and only verified employers may post jobs (OPS-EMP-04) — so you will approve
          it on the Operations console before it can do anything.
        </div>

        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={pending || !valid} onClick={() => start(async () => {try{
            const r = await actCreateEmployer(f);
            if ('error' in r) { setMsg(<span style={{ color: 'var(--bad)' }}>Failed: {r.error}</span>); return; }
            setMsg(<>Created <strong>{r.employerId}</strong> with branch {r.locationId} and admin {r.userId}. Approve it on the Operations console to let it post jobs.</>);
            router.push('/ops/employers');
          }catch(error){setMsg(error instanceof Error?error.message:'Could not save. Please try again.');}})}>{pending?'Saving…':'Create employer'}</button>
          <button className="btn" onClick={() => router.push('/ops/employers')}>Cancel</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}
