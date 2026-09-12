'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  actRespondToAlert, actWaApply, actRespondInterview, actRespondOffer,
  actUploadDocument, actUpdatePreferences, actRaiseDataRequest, actHideEndorsement,
} from '../actions';

export function CandidatePicker({ candidates, current, base }: {
  candidates: { id: string; name: string | null }[]; current: string; base: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Candidates are created continuously through the WhatsApp demo, so `candidates`
  // is only the most recent handful (capped by the caller) — a text jump lets an
  // admin reach any other one by id instead of needing an ever-growing list.
  return (
    <div style={{ minWidth: 250 }}>
      <label htmlFor="cand-pick">Viewing as candidate (recent)</label>
      <select id="cand-pick" value={current} onChange={(e) => router.push(`${base}?c=${e.target.value}`)}>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.id} — {c.name?.replace(/^DEMO /, '')}</option>
        ))}
      </select>
      <div className="btnrow mt" style={{ gap: 6 }}>
        <input placeholder="Candidate ID, e.g. CAN-001" value={query}
               onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 0 }} />
        <button type="button" className="btn btn-sm" disabled={!query.trim()}
                onClick={() => router.push(`${base}?c=${encodeURIComponent(query.trim())}`)}>Go</button>
      </div>
    </div>
  );
}

/** ALT-04 — the five actions a job alert offers. */
export function AlertActions({ alertId, candidateId, jobId, alreadyApplied, responded }: {
  alertId: string; candidateId: string; jobId: string; alreadyApplied: boolean; responded: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const reply = (r: string, after?: () => Promise<unknown>) => start(async () => {
    await actRespondToAlert(alertId, r);
    if (after) await after();
    setMsg(r === 'STOP_ALERTS' ? 'Alerts turned off. Job access is unaffected.' : 'Recorded.');
  });

  if (responded) return <span className="small muted">{msg ?? 'replied'}</span>;
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        {!alreadyApplied && (
          <button className="btn btn-sm btn-primary" disabled={pending}
                  onClick={() => reply('APPLY', () => actWaApply(candidateId, jobId))}>Apply</button>
        )}
        <button className="btn btn-sm" disabled={pending} onClick={() => reply('NOT_INTERESTED')}>Not interested</button>
        <button className="btn btn-sm" disabled={pending} onClick={() => reply('STOP_ALERTS')}>Stop alerts</button>
      </div>
      {msg && <div className="small muted mt">{msg}</div>}
    </div>
  );
}

export function InterviewReply({ interviewId }: { interviewId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (msg) return <span className="small muted">{msg}</span>;
  return (
    <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
        await actRespondInterview(interviewId, true); setMsg('Confirmed');
      })}>Yes, I will come</button>
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        await actRespondInterview(interviewId, false); setMsg('Declined');
      })}>Cannot make it</button>
    </div>
  );
}

export function OfferReply({ caseId }: { caseId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (msg) return <span className="small muted">{msg}</span>;
  return (
    <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
        const r = await actRespondOffer(caseId, true);
        setMsg('error' in r ? r.error! : 'Accepted — document checklist opened');
      })}>Accept</button>
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        await actRespondOffer(caseId, false); setMsg('Declined');
      })}>Decline</button>
    </div>
  );
}

export function DocUpload({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (msg) return <span className="small muted">{msg}</span>;
  return (
    <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
      await actUploadDocument(documentId);
      setMsg('Uploaded (watermarked placeholder)');
    })}>Upload</button>
  );
}

/** CAN-04 — preferences the candidate controls, including alert frequency. */
export function PreferencesForm({ candidateId, initial }: {
  candidateId: string;
  initial: {
    language: 'mr' | 'hi' | 'en'; maxCommuteMin: number; expectedPayRupees: number;
    quietFrom: number; quietTo: number; maxPerWeek: number;
  };
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-body">
        <div className="grid g2">
          <div className="field">
            <label htmlFor="pl">Language</label>
            <select id="pl" value={f.language}
                    onChange={(e) => setF({ ...f, language: e.target.value as 'mr' | 'hi' | 'en' })}>
              <option value="mr">मराठी — Marathi</option>
              <option value="hi">हिन्दी — Hindi</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pc">Maximum one-way commute (minutes)</label>
            <input id="pc" type="number" value={f.maxCommuteMin}
                   onChange={(e) => setF({ ...f, maxCommuteMin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="pe">Expected pay (₹ / month)</label>
            <input id="pe" type="number" value={f.expectedPayRupees}
                   onChange={(e) => setF({ ...f, expectedPayRupees: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="pw">Maximum job alerts per week</label>
            <input id="pw" type="number" min={0} max={20} value={f.maxPerWeek}
                   onChange={(e) => setF({ ...f, maxPerWeek: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="qf">Quiet hours from (24h)</label>
            <input id="qf" type="number" min={0} max={23} value={f.quietFrom}
                   onChange={(e) => setF({ ...f, quietFrom: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="qt">Quiet hours until (24h)</label>
            <input id="qt" type="number" min={0} max={23} value={f.quietTo}
                   onChange={(e) => setF({ ...f, quietTo: Number(e.target.value) })} />
          </div>
        </div>

        <div className="note small">
          Quiet hours and the weekly cap are promises, not preferences we ignore: an alert outside
          them is suppressed rather than queued, and the reason is recorded. <span className="clause">ALT-02</span>
        </div>

        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
            await actUpdatePreferences(candidateId, {
              language: f.language, maxCommuteMin: f.maxCommuteMin,
              expectedPayPaise: Math.round(f.expectedPayRupees * 100),
              alertQuietFrom: f.quietFrom, alertQuietTo: f.quietTo, alertMaxPerWeek: f.maxPerWeek,
            });
            setMsg('Saved. Re-run matching on a job to see the effect on your position.');
          })}>Save preferences</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}

/** CAN-06 — access, correction and erasure. */
export function DataRequestForm({ candidateId }: { candidateId: string }) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState('ACCESS');
  const [detail, setDetail] = useState('Please send me a copy of everything you hold about me.');
  const [msg, setMsg] = useState<React.ReactNode>(null);

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-body">
        <div className="field">
          <label htmlFor="drk">What do you want to do?</label>
          <select id="drk" value={kind} onChange={(e) => {
            setKind(e.target.value);
            setDetail(e.target.value === 'ACCESS' ? 'Please send me a copy of everything you hold about me.'
              : e.target.value === 'CORRECTION' ? 'My locality is wrong — I have moved to Aundh.'
              : 'Please delete my profile and stop all processing.');
          }}>
            <option value="ACCESS">Get a copy of my data</option>
            <option value="CORRECTION">Correct something that is wrong</option>
            <option value="ERASURE">Delete my data</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="drd">Details</label>
          <input id="drd" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <div className="btnrow">
          <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
            const r = await actRaiseDataRequest(candidateId, kind, detail);
            setMsg(<>Request <strong>{r.id}</strong> raised. It appears in the operations queue with a
              90-day response clock, which is what the DPDP Rules require.</>);
          })}>Submit request</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}

/** END-09 — the candidate can hide an endorsement; hidden scores zero. */
export function EndorsementVisibility({ id, hidden }: { id: string; hidden: boolean }) {
  const [pending, start] = useTransition();
  const [isHidden, setHidden] = useState(hidden);
  return (
    <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
      await actHideEndorsement(id, !isHidden); setHidden(!isHidden);
    })}>{isHidden ? 'Show' : 'Hide'}</button>
  );
}
