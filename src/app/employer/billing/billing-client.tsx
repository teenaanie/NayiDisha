'use client';
import { useState, useTransition } from 'react';
import { actBuyCredits } from '../../actions';
import { formatINR } from '@/lib/money';

export function BuyCredits({ jobId, pricePaise }: { jobId: string; pricePaise: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        await actBuyCredits(jobId, 10);
        setMsg(`+10 at ${formatINR(pricePaise)} each`);
      })}>Buy 10</button>
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}
