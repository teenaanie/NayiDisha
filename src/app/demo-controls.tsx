'use client';
import { useState, useTransition } from 'react';
import { actAdvanceClock, actResetClock } from './actions';

/**
 * Demo clock controls (§21.2).
 *
 * Advancing the clock is how the 72-hour reward hold, the 72-hour replacement
 * window and 30-day job expiry get demonstrated inside a 20-minute session.
 */
export function DemoControls() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const advance = (h: number, label: string) => start(async () => {
    await actAdvanceClock(h);
    setMsg(`Clock advanced ${label}. Matured holds released, stale jobs expired.`);
  });

  return (
    <div className="card">
      <div className="card-head"><h3>Demo clock</h3><span className="clause">§21.2</span></div>
      <div className="card-body">
        <p className="small muted">
          Every domain timestamp comes from this clock, never the wall clock. That is what makes
          holds and expiry windows provable in a demo rather than theoretical.
        </p>
        <div className="btnrow">
          <button className="btn btn-sm" disabled={pending} onClick={() => advance(24, '24 hours')}>+24h</button>
          <button className="btn btn-sm" disabled={pending} onClick={() => advance(73, '73 hours')}>+73h (clears hold)</button>
          <button className="btn btn-sm" disabled={pending} onClick={() => advance(24 * 31, '31 days')}>+31d (expires jobs)</button>
          <button className="btn btn-sm" disabled={pending}
                  onClick={() => start(async () => { await actResetClock(); setMsg('Clock reset to the canonical seed instant.'); })}>
            Reset clock
          </button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
        <div className="note warn mt small">
          To restore the full canonical dataset, run <code>npm run db:reset</code>. Reset is
          deliberately a command rather than a button so a demo cannot be wiped by a stray click.
        </div>
      </div>
    </div>
  );
}
