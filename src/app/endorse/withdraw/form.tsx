'use client';
import { useState, useTransition } from 'react';
import { actWithdrawEndorsement } from '../../actions';

export function WithdrawForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [t, setT] = useState(token);
  const [msg, setMsg] = useState<React.ReactNode>(null);

  return (
    <div className="card"><div className="card-body">
      <div className="field">
        <label htmlFor="wt">Your withdrawal link code</label>
        <input id="wt" value={t} onChange={(e) => setT(e.target.value)} />
      </div>
      <div className="btnrow">
        <button className="btn btn-primary" disabled={pending || !t} onClick={() => start(async () => {
          const r = await actWithdrawEndorsement(t);
          setMsg('error' in r
            ? <span style={{ color: 'var(--bad)' }}>Not found, or already withdrawn.</span>
            : <>Withdrawn. {r.endorsementId} now scores zero and is hidden from employers.</>);
        })}>Withdraw</button>
      </div>
      {msg && <div className="note mt small">{msg}</div>}
    </div></div>
  );
}
