'use client';
import { useState, useTransition } from 'react';
import { actReleaseHolds, actBuildBatch, actApprovePayout } from '../actions';

export function FinanceActions() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<React.ReactNode>(null);

  return (
    <div className="card mb">
      <div className="card-body">
        <div className="flexb">
          <div className="btnrow">
            <button className="btn" disabled={pending} onClick={() => start(async () => {
              await actReleaseHolds();
              setMsg('Matured holds released. Holds only clear once the demo clock passes hold_until.');
            })}>Release matured holds</button>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
              const r = await actBuildBatch();
              setMsg(
                <>
                  <strong>{r.created.length}</strong> payout{r.created.length === 1 ? '' : 's'} created.
                  {r.skipped.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {r.skipped.map((s) => (
                        <li key={s.partnerId}>
                          {s.partnerId} skipped — {s.reason.replace(/_/g, ' ').toLowerCase()} (balance ₹{s.balancePaise / 100})
                        </li>
                      ))}
                    </ul>
                  )}
                </>,
              );
            })}>Build weekly payout batch</button>
          </div>
          <span className="clause">REF-10</span>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}

export function PayoutRow({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (status !== 'PENDING_APPROVAL') return <span className="muted small">{msg ?? '—'}</span>;
  return (
    <div>
      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
        const r = await actApprovePayout(id);
        setMsg('ok' in r && r.ok ? 'Executed' : 'Failed');
      })}>Approve &amp; pay</button>
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
