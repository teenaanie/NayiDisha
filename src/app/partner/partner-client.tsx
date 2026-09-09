'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actSendNudge, actAcceptConduct } from '../actions';

export function PartnerPicker({ partners, current }: {
  partners: { id: string; name: string; status: string }[];
  current: string;
}) {
  const router = useRouter();
  return (
    <div style={{ minWidth: 260 }}>
      <label htmlFor="partner-pick">Viewing as partner</label>
      <select id="partner-pick" value={current}
              onChange={(e) => router.push(`/partner?p=${e.target.value}`)}>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} — {p.name}{p.status !== 'VERIFIED' ? ` (${p.status.toLowerCase()})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NudgeButton({ partnerId, candidateId, jobs, disabled, usedThisWeek }: {
  partnerId: string; candidateId: string;
  jobs: { id: string; title: string; brand: string }[];
  disabled: boolean; usedThisWeek: number;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  if (disabled) return <span className="small muted">no consent</span>;
  if (!open) {
    return (
      <div>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>Nudge</button>
        <div className="small muted">{usedThisWeek}/2 this week</div>
        {msg && <div className="small muted">{msg}</div>}
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'left', minWidth: 220 }}>
      <div className="field">
        <label htmlFor={`nj-${candidateId}`}>About which job</label>
        <select id={`nj-${candidateId}`} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.id} — {j.title}</option>)}
        </select>
      </div>
      <div className="btnrow">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await actSendNudge(partnerId, candidateId, jobId);
          setMsg('error' in r
            ? r.error!.replace(/_/g, ' ').toLowerCase()
            : 'Platform message sent. You cannot change its wording.');
          setOpen(false);
        })}>Send</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function AcceptConduct({ partnerId }: { partnerId: string }) {
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: '.92rem', color: 'var(--ink)' }}>
        <input type="checkbox" style={{ width: 16, marginTop: 3 }}
               checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I have read these rules and agree to follow every one of them.</span>
      </label>
      <div className="btnrow mt">
        <button className="btn btn-primary" disabled={pending || !checked} onClick={() => start(async () => {
          await actAcceptConduct(partnerId);
          setMsg('Accepted. The version and timestamp are recorded in the audit log.');
        })}>Accept conduct rules</button>
      </div>
      {msg && <div className="note mt small">{msg}</div>}
    </div>
  );
}
