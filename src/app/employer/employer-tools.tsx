'use client';
import { useState, useTransition } from 'react';
import { actCreateLocation } from '../actions';

/** OPS-EMP-03 — an employer can have several branches; a job is posted for one of them. */
export function AddLocation({ employerId, localities }: {
  employerId: string;
  localities: { key: string; display_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ name: 'Aundh Branch', localityKey: 'aundh', hours: '09:00-19:00' });

  if (!open) {
    return <button className="btn btn-sm" onClick={() => setOpen(true)}>+ Add branch</button>;
  }
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="card-body">
        <div className="grid g3">
          <div className="field">
            <label htmlFor="ln">Branch name</label>
            <input id="ln" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="lk">Locality</label>
            <select id="lk" value={f.localityKey} onChange={(e) => setF({ ...f, localityKey: e.target.value })}>
              {localities.map((l) => <option key={l.key} value={l.key}>{l.display_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hr">Hours</label>
            <input id="hr" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          </div>
        </div>
        <div className="btnrow">
          <button className="btn btn-sm btn-primary" disabled={pending || !f.name.trim()}
                  onClick={() => start(async () => {
            const r = await actCreateLocation(employerId, f.name, f.localityKey, f.hours);
            setMsg('error' in r ? `Failed: ${r.error}` : `Created ${r.locationId}. It can now be selected when posting a job.`);
            if (!('error' in r)) setOpen(false);
          })}>Create branch</button>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}
