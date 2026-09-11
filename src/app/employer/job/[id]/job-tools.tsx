'use client';
import {WorkflowForm} from '../../../workflow-form';
import { useState, useTransition } from 'react';
import { actBuyCredits, actRecomputeMatches } from '../../../actions';
import { formatINR } from '@/lib/money';

/**
 * §9.1 — additional credits are purchased before an unlock, once the included
 * pack is used up. MATCH-01/06 — re-running matching is what makes a
 * configuration change visible without waiting for new applications.
 */
export function JobTools({ jobId, creditPricePaise }: { jobId: string; creditPricePaise: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="btnrow">
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        await actBuyCredits(jobId, 10);
        setMsg(`10 credits purchased at ${formatINR(creditPricePaise)} each — the ledger records the purchase as a separate entry.`);
      })}>Buy 10 more credits</button>



<WorkflowForm kind="request_credits" id={jobId} label="Request credits"><input type="number" name="quantity" min="1" max="100" defaultValue="10"/><input name="reason" required placeholder="Why credits are needed"/></WorkflowForm>
      {msg && <span className="small muted" style={{ flexBasis: '100%', marginTop: 6 }}>{msg}</span>}
    </div>
  );
}
