'use client';
import { useState, useTransition } from 'react';
import { actSubmitEndorsement } from '../../actions';

const RELATIONSHIPS = [
  ['FORMER_MANAGER', 'I was their manager'],
  ['SENIOR_COLLEAGUE', 'I was senior to them'],
  ['EXPERIENCED_COLLEAGUE', 'We worked together'],
  ['PEER', 'We are peers'],
];
const COMPETENCIES = [
  'CUSTOMER_COMMUNICATION', 'RELIABILITY', 'LEARNING_AGILITY',
  'TARGET_ACHIEVEMENT', 'TEAMWORK', 'INTEGRITY',
];

export function EndorserForm({ token, candidateName }: { token: string; candidateName: string }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    relationship: 'FORMER_MANAGER', periodKnown: '18 months', comment: '',
    displayConsent: false, otp: '',
  });
  const [comps, setComps] = useState<string[]>(['CUSTOMER_COMMUNICATION']);
  const [done, setDone] = useState<React.ReactNode>(null);

  if (done) return <div className="card"><div className="card-body">{done}</div></div>;

  const ready = f.displayConsent && /^\d{6}$/.test(f.otp) && comps.length > 0;

  return (
    <div className="card">
      <div className="card-body">
        <div className="field">
          <label htmlFor="rel">How do you know {candidateName}?</label>
          <select id="rel" value={f.relationship}
                  onChange={(e) => setF({ ...f, relationship: e.target.value })}>
            {RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="per">For how long?</label>
          <input id="per" value={f.periodKnown} onChange={(e) => setF({ ...f, periodKnown: e.target.value })} />
        </div>
        <div className="field">
          <label>What are they good at?</label>
          <div className="tags" style={{ gap: 8 }}>
            {COMPETENCIES.map((c) => (
              <button key={c} type="button" className={`btn btn-sm ${comps.includes(c) ? 'btn-primary' : ''}`}
                      onClick={() => setComps(comps.includes(c) ? comps.filter((x) => x !== c) : [...comps, c])}>
                {comps.includes(c) ? '✓ ' : ''}{c.replace(/_/g, ' ').toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="cmt">Anything you would like to add (optional)</label>
          <input id="cmt" value={f.comment} placeholder="Handled walk-in customers calmly."
                 onChange={(e) => setF({ ...f, comment: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="otp">Verification code sent to you (demo: any 6 digits)</label>
          <input id="otp" value={f.otp} placeholder="123456"
                 onChange={(e) => setF({ ...f, otp: e.target.value })} />
        </div>

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: '.9rem', color: 'var(--ink)' }}>
          <input type="checkbox" style={{ width: 16, marginTop: 3 }} checked={f.displayConsent}
                 onChange={(e) => setF({ ...f, displayConsent: e.target.checked })} />
          <span>
            I agree that employers may see my relationship to {candidateName} and what I have written.
            My phone number and email are never shown to them.
          </span>
        </label>

        <div className="note small mt">
          &ldquo;Verified contact&rdquo; means we checked this channel reached you — not that we
          independently proved every claim. Employers are shown that distinction.
        </div>

        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={pending || !ready} onClick={() => start(async () => {
            const r = await actSubmitEndorsement(token, {
              relationship: f.relationship, periodKnown: f.periodKnown, competencies: comps,
              comment: f.comment, displayConsent: f.displayConsent, otp: f.otp,
            });
            if ('error' in r) {
              setDone(<p style={{ color: 'var(--bad)' }}>{r.error!.replace(/_/g, ' ').toLowerCase()}</p>);
              return;
            }
            setDone(
              <>
                <h2>Thank you</h2>
                <p>Your endorsement has been recorded{r.flagged ? ', and flagged for review' : ''}.</p>
                <p className="small muted">
                  If you change your mind, you can withdraw it at any time using this link:
                </p>
                <p className="mono small">/endorse/withdraw?t={r.withdrawToken}</p>
              </>,
            );
          })}>Submit</button>
        </div>
      </div>
    </div>
  );
}
