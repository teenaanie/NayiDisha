import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { interviewsForEmployer, onboardingCasesForEmployer, documentsForCase } from '@/modules/hiring';
import { Clause, Money, StatusPill } from '../../ui';
import { SubNav, EMPLOYER_TABS } from '../../subnav';
import { InterviewPanel, OfferPanel, DocumentReview, ReminderButton } from './hiring-client';

export const dynamic = 'force-dynamic';

export default async function HiringPage() {
  const viewer=await scopePage('employer');
  const employerId = viewer.role==='ADMIN' ? 'EMP-001' : viewer.id;

  const interviews = await interviewsForEmployer(employerId);
  const cases = await onboardingCasesForEmployer(employerId);
  const docsByCase = new Map<string, Awaited<ReturnType<typeof documentsForCase>>>();
  for (const c of cases) docsByCase.set(c.id, await documentsForCase(c.id));

  /** Only unlocked candidates can be scheduled or offered — you cannot
   *  interview someone whose contact details you have not paid to see. */
  const unlocked = await sql<{
    application_id: string; candidate_id: string; name: string; job_id: string;
    title: string; status: string; has_interview: boolean; has_case: boolean;
  }[]>`
    SELECT u.application_id, u.candidate_id, CASE WHEN EXISTS(SELECT 1 FROM app.consent_record cr WHERE cr.candidate_id=c.id AND cr.purpose='PROCESSING' AND cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL) THEN c.name ELSE 'Access withdrawn' END AS name, u.job_id, j.title, a.status,
           EXISTS (SELECT 1 FROM app.interview i WHERE i.application_id = u.application_id) AS has_interview,
           EXISTS (SELECT 1 FROM app.onboarding_case o WHERE o.application_id = u.application_id) AS has_case
      FROM app.qualified_lead_unlock u
      JOIN app.candidate c ON c.id = u.candidate_id
      JOIN app.job j ON j.id = u.job_id
      JOIN app.application a ON a.id = u.application_id
     WHERE u.employer_id = ${employerId} AND u.status = 'CONFIRMED'
     ORDER BY u.unlocked_at DESC
  `;

  const locations = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM app.employer_location WHERE employer_id = ${employerId} ORDER BY id
  `;

  const noShows = interviews.filter((i) => i.status.startsWith('NO_SHOW')).length;
  const attended = interviews.filter((i) => i.status === 'ATTENDED').length;

  return (
    <>
      <SubNav tabs={EMPLOYER_TABS} />
      <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>Interviews and onboarding</h1>
            <div className="sub">
              None of this affects the unlock charge or the partner reward — it is recorded because
              it is useful, not because billing waits for it{' '}
              <Clause>§8.9 · §8.10 · LEAD-10</Clause>
            </div>
          </div>
          <Link className="btn" href="/employer">← Employer</Link>
        </div>
      </div>

      <div className="card mb">
        <div className="card-head">
          <h2>Unlocked candidates</h2>
          <span className="small muted">
            {attended} attended · {noShows} no-show
          </span>
        </div>
        <div className="card-body tight">
          {unlocked.length === 0
            ? <div className="empty">Unlock a profile first — you cannot schedule someone whose contact you have not opened.</div>
            : <div className="tblwrap">
                <table>
                  <thead><tr><th>Candidate</th><th>Job</th><th>Status</th><th className="right">Schedule / offer</th></tr></thead>
                  <tbody>
                    {unlocked.map((u) => (
                      <tr key={u.application_id}>
                        <td><strong>{u.name}</strong><div className="id">{u.candidate_id}</div></td>
                        <td className="small">{u.title}<div className="id">{u.job_id}</div></td>
                        <td><StatusPill status={u.status} /></td>
                        <td className="right">
                          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
                            {!u.has_interview && <InterviewPanel applicationId={u.application_id} />}
                            {!u.has_case && (
                              <OfferPanel applicationId={u.application_id} defaultTitle={u.title}
                                          locations={locations} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Interviews</h2>
          <div className="btnrow"><Clause>§8.9 INT-01..06</Clause><ReminderButton /></div>
        </div>
        <div className="card-body tight">
          {interviews.length === 0 ? <div className="empty">No interviews scheduled.</div> : (
            <div className="tblwrap">
              <table>
                <thead>
                  <tr><th>Candidate</th><th>When</th><th>Where</th><th>Confirmed</th><th>Status</th><th className="right">Record</th></tr>
                </thead>
                <tbody>
                  {interviews.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}<div className="id">{i.job_id}</div></td>
                      <td className="small">
                        {fmtDateTime(i.scheduled_at)}
                        {i.rescheduled_from && (
                          <div className="muted small">was {fmtDateTime(i.rescheduled_from)}</div>
                        )}
                        {i.reminder_sent_at && <div className="muted small">reminder sent</div>}
                      </td>
                      <td className="small">
                        {i.location_note}
                        {i.safety_note && <div className="muted small">{i.safety_note}</div>}
                      </td>
                      <td>{i.candidate_confirmed
                        ? <span className="pill p-ok">yes</span>
                        : <span className="pill p-warn">awaiting</span>}</td>
                      <td><StatusPill status={i.status} /></td>
                      <td className="right"><InterviewPanel mode="record" interviewId={i.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="note small" style={{ margin: 14 }}>
            A no-show is recorded against whichever side missed it — candidate <em>or</em> employer.
            §16.3 asks for both rates, and only counting one of them would be self-serving.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Onboarding cases</h2><Clause>§8.10 ONB-01..08</Clause></div>
        <div className="card-body tight">
          {cases.length === 0 ? <div className="empty">No offers made.</div> : (
            <div className="tblwrap">
              <table>
                <thead>
                  <tr><th>Case</th><th>Candidate</th><th>Offer</th><th>Joining</th><th className="num">Documents</th><th>Status</th><th className="right">Review</th></tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td className="id">{c.id}</td>
                      <td>{c.name}<div className="small muted">{c.role_title}</div></td>
                      <td className="small mono">
                        <Money paise={c.offer_fixed_paise} /> fixed
                        {Number(c.offer_variable_paise) > 0 && (
                          <div className="muted">+ up to <Money paise={c.offer_variable_paise} /></div>
                        )}
                      </td>
                      <td className="small">{c.joining_date ?? '—'}
                        <div className="muted small">offer to {fmtDateTime(c.offer_expires_at)}</div>
                      </td>
                      <td className="num">{c.docs_approved}/{c.docs_total}</td>
                      <td><StatusPill status={c.status} /></td>
                      <td className="right">
                        <DocumentReview caseId={c.id} status={c.status}
                                        documents={docsByCase.get(c.id) ?? []} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="note small" style={{ margin: 14 }}>
            The checklist is generated from the role configuration, so a different industry asks for
            different papers with no code change. Documents are referenced, never stored inline, and
            a rejection must carry a reason the candidate can act on. <Clause>ONB-03 / ONB-07</Clause>
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
