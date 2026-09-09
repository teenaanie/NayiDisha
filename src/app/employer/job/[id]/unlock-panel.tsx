'use client';
import { useState, useTransition } from 'react';
import { actUnlock, actRecordOutcome, actRaiseReplacement } from '../../../actions';
import { formatINR } from '@/lib/money';

interface Props {
  employerId: string; jobId: string; candidateId: string;
  alreadyUnlocked?: boolean; pricePaise?: number; creditsAvailable?: number;
  mode?: 'preview' | 'post'; unlockId?: string; applicationId?: string; disabled?: boolean;
}

/**
 * LEAD-04 — the price and the data about to be revealed are shown before the
 * employer confirms. Unlock is never a side effect of viewing.
 */
export function UnlockPanel(props: Props) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  if (props.mode === 'post') {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        {!claiming ? (
          <>
            <select aria-label="Record outcome" style={{ width: 150 }} disabled={props.disabled || pending}
              onChange={(e) => {
                const v = e.target.value; if (!v) return;
                start(async () => { await actRecordOutcome(props.applicationId!, v); setResult('Outcome recorded.'); });
              }}>
              <option value="">Record outcome…</option>
              <option value="CONTACTED">Contacted</option>
              <option value="INTERVIEW_SCHEDULED">Interview scheduled</option>
              <option value="REJECTED">Rejected</option>
              <option value="SELECTED">Selected</option>
              <option value="JOINED">Joined</option>
            </select>
            <button className="btn btn-sm" disabled={props.disabled || pending}
                    onClick={() => setClaiming(true)}>Claim replacement</button>
          </>
        ) : (
          <div style={{ textAlign: 'left', minWidth: 260 }}>
            <div className="small muted mb">
              Accepted reasons only. &ldquo;Did not pass our interview&rdquo; is not a valid claim.
            </div>
            <div className="btnrow">
              <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
                const r = await actRaiseReplacement(props.unlockId!, 'INVALID_CONTACT',
                  'Number unreachable across three attempts; call log attached.');
                setResult('id' in r ? `Claim ${r.id} raised — awaiting operations.` : `Rejected: ${r.error}`);
                setClaiming(false);
              })}>Invalid contact</button>
              <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
                const r = await actRaiseReplacement(props.unlockId!, 'NEVER_APPLIED',
                  'Candidate states they never applied to this role.');
                setResult('id' in r ? `Claim ${r.id} raised — awaiting operations.` : `Rejected: ${r.error}`);
                setClaiming(false);
              })}>Never applied</button>
              <button className="btn btn-sm" onClick={() => setClaiming(false)}>Cancel</button>
            </div>
          </div>
        )}
        {result && <div className="small muted" style={{ width: '100%', marginTop: 6 }}>{result}</div>}
      </div>
    );
  }

  if (props.alreadyUnlocked) return <span className="pill p-ok">unlocked</span>;

  if (!confirming) {
    return (
      <div><button className="btn btn-sm btn-primary" disabled={pending || (props.creditsAvailable ?? 0) <= 0}
              onClick={() => setConfirming(true)}>
        Unlock profile
      </button>{result && <p role="status" className="small">{result}</p>}</div>
    );
  }

  return (
    <div style={{ textAlign: 'left', minWidth: 240 }}>
      <div className="small mb">
        Consumes <strong>1 credit</strong> ({formatINR(props.pricePaise ?? 0)}).
        Reveals name, phone, locality, experience and pay expectation.
      </div>
      <div className="btnrow">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await actUnlock(props.employerId, props.jobId, props.candidateId);
          setResult(
            r.status === 'CREATED' ? `Unlocked as ${r.unlockId}.`
            : r.status === 'ALREADY_UNLOCKED' ? `Already unlocked as ${r.unlockId} — no second charge.`
            : `Blocked: ${r.reason}`,
          );
          setConfirming(false);
        })}>Confirm unlock</button>
        <button className="btn btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
      {result && <div className="small muted mt">{result}</div>}
    </div>
  );
}
