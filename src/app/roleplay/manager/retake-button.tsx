'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '../api';

/** Allow one more graded attempt for a learner who has used theirs. */
export function RetakeButton({ learnerId, scenarioId, learner }: { learnerId: string; scenarioId: string; learner: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return <span>
    <button className="btn btn-sm" disabled={busy} onClick={async () => {
      const reason = window.prompt(`Allow ${learner} to take this assessment again? Add a reason (optional):`, '');
      if (reason === null) return;
      setBusy(true); setMsg('');
      try { await api('POST', 'manager/assessments/retakes', { learner_id: learnerId, scenario_id: scenarioId, reason }); setMsg('Retake allowed'); router.refresh(); }
      catch (e) { setMsg(e instanceof ApiFailure ? e.message : 'Could not allow a retake.'); }
      finally { setBusy(false); }
    }}>{busy ? 'Allowing…' : 'Allow a retake'}</button>
    {msg && <span className="small muted"> {msg}</span>}
  </span>;
}
