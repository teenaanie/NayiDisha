'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, newKey, sleep, ApiFailure } from '../../api';

type Turn = { turn_id: string; sequence: number; speaker: 'learner' | 'customer'; text: string; origin: string };
type Session = { session_id: string; revision: number; state: string; transcript: Turn[]; pending_operation: { id: string } | null; started_at: string; retry_scope: { mode: string; target_check_ids: string[] } | null; limits: { max_message_chars: number; max_learner_turns: number; reminder_minutes: number[] } };
type Brief = { learner_brief: string; learner_role: string; customer: { name: string; role: string }; target_minutes: { min: number; max: number } };

export function PracticeClient({ initial, brief }: { initial: Session; brief: Brief }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<{ text: string; retryOp?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const finishKey = useRef(newKey());
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [s.transcript.length]);
  useEffect(() => { const t = setInterval(() => setMinutes(Math.floor((Date.now() - new Date(initial.started_at).getTime()) / 60000)), 15000); return () => clearInterval(t); }, [initial.started_at]);

  const refresh = async () => { const r = await api<Session>('GET', `sessions/${s.session_id}`); setS(r.data); return r.data; };
  const waitFor = async (opId: string) => {
    for (let i = 0; i < 120; i++) {
      const r = await api('GET', `operations/${opId}`);
      if (r.data.status === 'succeeded') { await refresh(); return; }
      if (r.data.status === 'failed') { await refresh(); setError({ text: r.data.error?.message ?? 'The customer could not reply. Try again.', retryOp: r.data.error?.code === 'GENERATION_FAILED' ? opId : undefined }); return; }
      await sleep(i < 10 ? 400 : 1500);
    }
    setError({ text: 'The reply is taking longer than usual. It will appear when ready; refresh in a moment.' });
  };
  // A pending reply left from a reload is picked up again.
  useEffect(() => { if (initial.pending_operation) { setBusy(true); waitFor(initial.pending_operation.id).finally(() => setBusy(false)); } }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError(null); setStatus('Sending…');
    const clientMessageId = newKey();
    try {
      let receipt;
      try { receipt = await api('POST', `sessions/${s.session_id}/turns`, { client_message_id: clientMessageId, text, expected_revision: s.revision }); }
      catch (e) {
        // Network blip: resending with the same client_message_id cannot duplicate the turn.
        if (!(e instanceof ApiFailure)) receipt = await api('POST', `sessions/${s.session_id}/turns`, { client_message_id: clientMessageId, text, expected_revision: s.revision });
        else throw e;
      }
      setDraft('');
      setS((x) => ({ ...x, transcript: [...x.transcript, { turn_id: receipt.data.accepted_turn_id, sequence: x.transcript.length, speaker: 'learner', text, origin: 'live' }] }));
      setStatus(`${brief.customer.name} is replying…`);
      await waitFor(receipt.data.operation_id);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'STALE_REVISION') { await refresh(); setError({ text: 'The conversation was updated elsewhere; it has been refreshed. Send your message again.' }); }
      else if (e instanceof ApiFailure && e.code === 'SESSION_NOT_ACTIVE') { router.push(`/roleplay/s/${s.session_id}/report`); }
      else setError({ text: e instanceof ApiFailure ? e.message : 'Could not send. Check your connection and try again.' });
    } finally { setBusy(false); setStatus(''); }
  };

  const retryOp = async (op: string) => { setBusy(true); setError(null); try { await api('POST', `operations/${op}/retry`); await waitFor(op); } catch (e) { setError({ text: e instanceof ApiFailure ? e.message : 'Retry failed.' }); } finally { setBusy(false); } };

  const finish = async (cancelPending = false) => {
    setFinishing(true); setError(null);
    try {
      const latest = await refresh();
      await api('POST', `sessions/${s.session_id}/finish`, { expected_revision: latest.revision, cancel_pending: cancelPending }, { idempotencyKey: finishKey.current });
      router.push(`/roleplay/s/${s.session_id}/report`);
    } catch (e) {
      finishKey.current = newKey();
      setError({ text: e instanceof ApiFailure ? e.message : 'Could not finish.' });
      setFinishing(false);
    }
  };

  const learnerTurns = s.transcript.filter((t) => t.speaker === 'learner' && t.origin !== 'retry_prefix').length;
  // Reminders say only how long it has been; they never hint at what to ask (spec §7).
  const reminder = s.limits.reminder_minutes.filter((m) => minutes >= m).pop();
  return <div className="grid g2">
    <section className="card"><div className="card-head"><h2>Your brief</h2></div><div className="card-body">
      <p className="small muted">You are the {brief.learner_role}. Suggested length {brief.target_minutes.min}–{brief.target_minutes.max} minutes; there is no forced ending.</p>
      <p>{brief.learner_brief}</p>
      {s.retry_scope?.mode === 'focused' && <div className="note mb">Focused practice: the conversation so far is carried over as context and earns no credit. Only the practice targets are assessed, and the result is not a comparable full score.</div>}
      {reminder && <p className="small" role="status">You have been practising for about {reminder} minutes.</p>}
      <p className="small muted">Messages used: {learnerTurns} of {s.limits.max_learner_turns}.</p>
      <div className="btnrow">
        <button className="btn" disabled={finishing || busy || learnerTurns === 0} onClick={() => finish(false)}>{finishing ? 'Finishing…' : 'Finish and get feedback'}</button>
      </div>
    </div></section>
    <section className="card"><div className="card-head"><h2>{brief.customer.name}</h2><span className="small muted">AI customer · {brief.customer.role}</span></div><div className="card-body">
      <div className="wa-body practice-chat" aria-live="polite" aria-label="Conversation">
        {s.transcript.map((t) => <div key={t.turn_id} className={'wa-msg ' + (t.speaker === 'customer' ? 'wa-in' : 'wa-out')} style={t.origin === 'retry_prefix' ? { opacity: 0.6 } : undefined}>
          {t.text}<div className="wa-meta">{t.speaker === 'customer' ? brief.customer.name : 'You'}{t.origin === 'retry_prefix' ? ' · earlier (context)' : ''}</div></div>)}
        {status && <div className="wa-msg wa-in small muted" role="status">{status}</div>}
        <div ref={end} />
      </div>
      {error && <div role="alert" className="note warn mt">{error.text} {error.retryOp && <button className="btn btn-sm" onClick={() => retryOp(error.retryOp!)}>Retry the reply</button>}</div>}
      <form className="practice-composer mt" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="rp-msg">Your message</label>
        <textarea id="rp-msg" value={draft} maxLength={s.limits.max_message_chars} disabled={finishing} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask the customer a question…" />
        <button className="btn btn-primary" disabled={busy || finishing || !draft.trim()}>Send</button>
      </form>
      <p className="small muted">{draft.length}/{s.limits.max_message_chars} characters · Enter to send, Shift+Enter for a new line</p>
    </div></section>
  </div>;
}
