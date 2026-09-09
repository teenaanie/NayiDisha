'use client';
import { useState, useTransition } from 'react';
import { actEditJob, actSetJobState, actDuplicateJob } from '../../actions';

/** JOB-01/04/05 — edit, pause, resume, close, fill, duplicate, archive. */
export function JobLifecycle({ jobId, status, fixedRupees, variableRupees, openings, title }: {
  jobId: string; status: string;
  fixedRupees: number; variableRupees: number; openings: number; title: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<'none' | 'menu' | 'edit'>('none');
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [f, setF] = useState({ title, fixedRupees, variableRupees, openings });

  const act = (fn: () => Promise<unknown>, done: (r: unknown) => React.ReactNode) =>
    start(async () => { const r = await fn(); setMsg(done(r)); setOpen('none'); });

  const editable = !['ARCHIVED', 'CLOSED', 'EXPIRED'].includes(status);

  if (open === 'edit') {
    return (
      <div style={{ textAlign: 'left', minWidth: 280 }}>
        <div className="field">
          <label htmlFor={`t-${jobId}`}>Title <span className="muted">(minor)</span></label>
          <input id={`t-${jobId}`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div className="grid g3">
          <div className="field">
            <label htmlFor={`fp-${jobId}`}>Fixed ₹ <span style={{ color: 'var(--warn)' }}>material</span></label>
            <input id={`fp-${jobId}`} type="number" value={f.fixedRupees}
                   onChange={(e) => setF({ ...f, fixedRupees: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor={`vp-${jobId}`}>Variable ₹ <span style={{ color: 'var(--warn)' }}>material</span></label>
            <input id={`vp-${jobId}`} type="number" value={f.variableRupees}
                   onChange={(e) => setF({ ...f, variableRupees: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor={`op-${jobId}`}>Openings <span style={{ color: 'var(--warn)' }}>material</span></label>
            <input id={`op-${jobId}`} type="number" value={f.openings}
                   onChange={(e) => setF({ ...f, openings: Number(e.target.value) })} />
          </div>
        </div>
        <div className="btnrow">
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(
            () => actEditJob(jobId, {
              title: f.title, openings: f.openings,
              fixedPayPaise: Math.round(f.fixedRupees * 100),
              variableMaxPaise: Math.round(f.variableRupees * 100),
            }),
            (r) => {
              const res = r as { changes?: unknown[]; notified?: number; material?: boolean; error?: string };
              if (res.error) return <span style={{ color: 'var(--bad)' }}>{res.error}</span>;
              if (!res.changes?.length) return 'No changes.';
              return res.material
                ? `Material change saved. ${res.notified} interested candidate(s) notified, matches revalidated.`
                : 'Minor change saved. No notification sent.';
            },
          )}>Save</button>
          <button className="btn btn-sm" onClick={() => setOpen('none')}>Cancel</button>
        </div>
        {msg && <div className="small muted mt">{msg}</div>}
      </div>
    );
  }

  if (open === 'menu') {
    return (
      <div style={{ textAlign: 'left', minWidth: 210 }}>
        <div className="btnrow">
          {editable && <button className="btn btn-sm" onClick={() => setOpen('edit')}>Edit</button>}
          {status === 'LIVE' && (
            <button className="btn btn-sm" disabled={pending} onClick={() => act(
              () => actSetJobState(jobId, 'PAUSED', 'Paused by employer'),
              () => 'Paused. Alerts and applications stop immediately.')}>Pause</button>
          )}
          {status === 'PAUSED' && (
            <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(
              () => actSetJobState(jobId, 'LIVE', 'Resumed by employer'),
              (r) => (r as { error?: string }).error ?? 'Resumed. Alerts dispatched again.')}>Resume</button>
          )}
          {['LIVE', 'PAUSED'].includes(status) && (
            <>
              <button className="btn btn-sm" disabled={pending} onClick={() => act(
                () => actSetJobState(jobId, 'FILLED', 'All openings filled'),
                () => 'Marked filled.')}>Mark filled</button>
              <button className="btn btn-sm" disabled={pending} onClick={() => act(
                () => actSetJobState(jobId, 'CLOSED', 'Closed by employer'),
                () => 'Closed.')}>Close</button>
            </>
          )}
          <button className="btn btn-sm" disabled={pending} onClick={() => act(
            () => actDuplicateJob(jobId),
            (r) => <>Created {(r as { jobId?: string }).jobId} as a draft awaiting approval.</>)}>Duplicate</button>
          {['CLOSED', 'FILLED', 'EXPIRED'].includes(status) && (
            <button className="btn btn-sm" disabled={pending} onClick={() => act(
              () => actSetJobState(jobId, 'ARCHIVED', 'Archived by employer'),
              () => 'Archived. Audit history is kept.')}>Archive</button>
          )}
          <button className="btn btn-sm" onClick={() => setOpen('none')}>Close menu</button>
        </div>
        {msg && <div className="small muted mt">{msg}</div>}
      </div>
    );
  }

  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen('menu')}>Manage ▾</button>
      {msg && <div className="small muted" style={{ width: '100%' }}>{msg}</div>}
    </>
  );
}
