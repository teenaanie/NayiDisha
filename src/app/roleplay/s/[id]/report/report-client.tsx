'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, newKey, ApiFailure } from '../../../api';

export function Poll({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 90 && !stop; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(`/v1/sessions/${sessionId}/report`, { cache: 'no-store' });
        if (r.status !== 202) { router.refresh(); return; }
      }
    })();
    return () => { stop = true; };
  }, [sessionId, router]);
  return <p role="status" className="muted">Working on it…</p>;
}

/** Re-run a failed assessment on the same saved transcript (reviewers and admins). */
export function RetryAssessment({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await api('POST', `evaluations/${assessmentId}/retry`, {}, { idempotencyKey: newKey() }); router.refresh(); }
    catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not retry the assessment.'); setBusy(false); }
  };
  return <div className="mt">
    <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Starting…' : 'Retry assessment'}</button>
    <p className="small muted">Runs the assessment again on the same saved transcript. The conversation is not changed.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

type Plan = { id: string; target_check_ids: string[] } | null;
export function RetryButtons({ sessionId, assessmentId, full, focused }: { sessionId: string; assessmentId: string; full: Plan; focused: Plan }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async (mode: 'full' | 'focused', plan: NonNullable<Plan>) => {
    setBusy(true); setError('');
    try {
      const r = await api('POST', `sessions/${sessionId}/retries`, { mode, retry_plan_id: plan.id, expected_assessment_id: assessmentId }, { idempotencyKey: newKey() });
      router.push(`/roleplay/s/${r.data.session.session_id}`);
    } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not start the retry.'); setBusy(false); }
  };
  return <div>
    <div className="btnrow">
      {focused && <button className="btn btn-primary" disabled={busy} onClick={() => go('focused', focused)}>Focused retry: {focused.target_check_ids.length} targets</button>}
      {full && <button className="btn" disabled={busy} onClick={() => go('full', full)}>Full retry from the start</button>}
    </div>
    <p className="small muted">A focused retry picks up the conversation part-way through and assesses only its targets. A full retry starts fresh and gets a comparable full score. Your original attempt is kept either way.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
