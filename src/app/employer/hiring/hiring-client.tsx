'use client';
import { useState, useTransition } from 'react';
import {
  actProposeInterview, actInterviewOutcome, actRescheduleInterview,
  actSendInterviewReminders, actMakeOffer, actReviewDocument, actMarkJoined,
} from '../../actions';

const DEFAULT_SLOT = '2026-10-09T11:00';

/** INT-01/03/05 — propose, reschedule, and record what actually happened. */
export function InterviewPanel({ applicationId, mode, interviewId }: {
  applicationId?: string; mode?: 'record'; interviewId?: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [when, setWhen] = useState(DEFAULT_SLOT);
  const [where, setWhere] = useState('FC Road Branch, ground floor. Ask for the branch manager.');
  const [safety, setSafety] = useState('Come to the branch reception. Never pay anyone for an interview.');

  if (mode === 'record') {
    return (
      <div style={{ textAlign: 'left' }}>
        <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
          <select aria-label="Record interview outcome" style={{ width: 168 }} disabled={pending}
                  onChange={(e) => {
                    const v = e.target.value; if (!v) return;
                    if (v === 'RESCHEDULE') { setOpen(true); return; }
                    start(async () => {
                      await actInterviewOutcome(interviewId!, v);
                      setMsg('Recorded.');
                    });
                  }}>
            <option value="">Record…</option>
            <option value="ATTENDED">Attended</option>
            <option value="NO_SHOW_CANDIDATE">Candidate no-show</option>
            <option value="NO_SHOW_EMPLOYER">We could not attend</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="RESCHEDULE">Reschedule…</option>
          </select>
        </div>
        {open && (
          <div className="mt" style={{ minWidth: 240 }}>
            <div className="field">
              <label htmlFor={`rs-${interviewId}`}>New time</label>
              <input id={`rs-${interviewId}`} type="datetime-local" value={when}
                     onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="btnrow">
              <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
                await actRescheduleInterview(interviewId!, new Date(when).toISOString());
                setMsg('Rescheduled. The original time is kept in the record and the candidate must confirm again.');
                setOpen(false);
              })}>Save</button>
              <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
        {msg && <div className="small muted mt">{msg}</div>}
      </div>
    );
  }

  if (!open) {
    return <button className="btn btn-sm" onClick={() => setOpen(true)}>Schedule interview</button>;
  }
  return (
    <div style={{ textAlign: 'left', minWidth: 300 }}>
      <div className="field">
        <label htmlFor={`w-${applicationId}`}>When</label>
        <input id={`w-${applicationId}`} type="datetime-local" value={when}
               onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`p-${applicationId}`}>Where</label>
        <input id={`p-${applicationId}`} value={where} onChange={(e) => setWhere(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`s-${applicationId}`}>Safety note shown to the candidate</label>
        <input id={`s-${applicationId}`} value={safety} onChange={(e) => setSafety(e.target.value)} />
      </div>
      <div className="btnrow">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await actProposeInterview(
            applicationId!, new Date(when).toISOString(), 'IN_PERSON', where, safety);
          setMsg('error' in r
            ? <span style={{ color: 'var(--bad)' }}>{r.error}</span>
            : <>Proposed as {r.interviewId}. The candidate confirms from WhatsApp — nothing is booked until they do.</>);
          setOpen(false);
        })}>Send invitation</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {msg && <div className="small muted mt">{msg}</div>}
    </div>
  );
}

export function ReminderButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        const r = await actSendInterviewReminders();
        setMsg(r.sent === 0
          ? 'Nothing due — reminders only go out within 24 hours of a confirmed interview. Advance the demo clock.'
          : `${r.sent} reminder(s) sent.`);
      })}>Send due reminders</button>
      {msg && <span className="small muted">{msg}</span>}
    </>
  );
}

/** ONB-01 — offer terms, with fixed and variable kept apart. */
export function OfferPanel({ applicationId, defaultTitle, locations }: {
  applicationId: string; defaultTitle: string;
  locations: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [f, setF] = useState({
    roleTitle: defaultTitle, locationId: locations[0]?.id ?? '',
    fixedRupees: 19000, variableRupees: 6000,
    joiningDate: '2026-10-20', offerValidHours: 72,
  });

  if (!open) return <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>Make offer</button>;

  return (
    <div style={{ textAlign: 'left', minWidth: 320 }}>
      <div className="grid g2">
        <div className="field">
          <label htmlFor={`rt-${applicationId}`}>Role title</label>
          <input id={`rt-${applicationId}`} value={f.roleTitle}
                 onChange={(e) => setF({ ...f, roleTitle: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`lc-${applicationId}`}>Branch</label>
          <select id={`lc-${applicationId}`} value={f.locationId}
                  onChange={(e) => setF({ ...f, locationId: e.target.value })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`of-${applicationId}`}>Fixed ₹ / month</label>
          <input id={`of-${applicationId}`} type="number" value={f.fixedRupees}
                 onChange={(e) => setF({ ...f, fixedRupees: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor={`ov-${applicationId}`}>Variable, maximum ₹</label>
          <input id={`ov-${applicationId}`} type="number" value={f.variableRupees}
                 onChange={(e) => setF({ ...f, variableRupees: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor={`jd-${applicationId}`}>Joining date</label>
          <input id={`jd-${applicationId}`} type="date" value={f.joiningDate}
                 onChange={(e) => setF({ ...f, joiningDate: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`oe-${applicationId}`}>Offer valid (hours)</label>
          <input id={`oe-${applicationId}`} type="number" value={f.offerValidHours}
                 onChange={(e) => setF({ ...f, offerValidHours: Number(e.target.value) })} />
        </div>
      </div>
      <div className="btnrow">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await actMakeOffer({ applicationId, ...f });
          setMsg('error' in r
            ? <span style={{ color: 'var(--bad)' }}>{r.error}</span>
            : <>Offer {r.caseId} sent. The candidate accepts from WhatsApp, which opens the document checklist.</>);
          setOpen(false);
        })}>Send offer</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {msg && <div className="small muted mt">{msg}</div>}
    </div>
  );
}

/** ONB-05/07 — case-scoped review, and a rejection must say why. */
export function DocumentReview({ caseId, status, documents }: {
  caseId: string; status: string;
  documents: { id: string; document_key: string; status: string; reject_reason: string | null }[];
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState('Photo is unreadable — please re-upload in daylight.');

  if (status === 'OFFER_SENT') return <span className="small muted">awaiting candidate</span>;
  if (documents.length === 0) return <span className="small muted">—</span>;

  if (!open) {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>Review documents</button>
        {status === 'DOCUMENTS_COMPLETE' && (
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
            await actMarkJoined(caseId); setMsg('Marked joined.');
          })}>Mark joined</button>
        )}
        {msg && <span className="small muted">{msg}</span>}
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'left', minWidth: 320 }}>
      <table>
        <tbody className="small">
          {documents.map((d) => (
            <tr key={d.id}>
              <td>{d.document_key.replace(/_/g, ' ')}</td>
              <td><span className={`pill ${d.status === 'APPROVED' ? 'p-ok' : d.status === 'REJECTED' ? 'p-bad' : d.status === 'UPLOADED' ? 'p-info' : 'p-mute'}`}>
                {d.status.toLowerCase()}</span>
                {d.reject_reason && <div className="muted">{d.reject_reason}</div>}
              </td>
              <td className="right">
                {d.status === 'UPLOADED' && (
                  <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => {
                      await actReviewDocument(d.id, 'APPROVED');
                    })}>Approve</button>
                    <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
                      const r = await actReviewDocument(d.id, 'REJECTED', reason);
                      if ('error' in r) setMsg(r.error!);
                    })}>Reject</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="field mt">
        <label htmlFor={`rr-${caseId}`}>Rejection reason (required to reject)</label>
        <input id={`rr-${caseId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="btnrow">
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Close</button>
      </div>
      {msg && <div className="small muted mt">{msg}</div>}
    </div>
  );
}
