import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { Clause } from '../../ui';
import { SubNav, CANDIDATE_TABS } from '../../subnav';
import { CandidatePicker, AlertActions, InterviewReply, OfferReply, DocUpload } from '../candidate-client';

export const dynamic = 'force-dynamic';

export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const candidateId = c ?? 'CAN-001';

  const all = await sql<{ id: string; name: string | null }[]>`
    SELECT id, name FROM app.candidate WHERE status='PROFILE_ACTIVE' ORDER BY id`;

  const alerts = await sql<{
    id: string; job_id: string; title: string; brand: string; loc: string;
    fixed_pay_paise: string; response: string | null; sent_at: Date; applied: boolean;
  }[]>`
    SELECT a.id, a.job_id, j.title, e.brand_name AS brand, l.name AS loc, j.fixed_pay_paise,
           a.response, a.sent_at,
           EXISTS (SELECT 1 FROM app.application ap
                    WHERE ap.candidate_id=a.candidate_id AND ap.job_id=a.job_id) AS applied
      FROM app.job_alert a
      JOIN app.job j ON j.id=a.job_id
      JOIN app.employer_organisation e ON e.id=j.employer_id
      JOIN app.employer_location l ON l.id=j.location_id
     WHERE a.candidate_id=${candidateId} ORDER BY a.sent_at DESC`;

  const interviews = await sql<{
    id: string; scheduled_at: Date | null; location_note: string | null; safety_note: string | null;
    status: string; candidate_confirmed: boolean; brand: string; title: string;
  }[]>`
    SELECT i.id, i.scheduled_at, i.location_note, i.safety_note, i.status, i.candidate_confirmed,
           e.brand_name AS brand, j.title
      FROM app.interview i
      JOIN app.application a ON a.id=i.application_id
      JOIN app.job j ON j.id=a.job_id
      JOIN app.employer_organisation e ON e.id=j.employer_id
     WHERE a.candidate_id=${candidateId} ORDER BY i.scheduled_at DESC`;

  const offers = await sql<{
    id: string; status: string; role_title: string; offer_fixed_paise: string;
    offer_variable_paise: string; joining_date: string | null; offer_expires_at: Date; brand: string;
  }[]>`
    SELECT o.id, o.status, o.role_title, o.offer_fixed_paise, o.offer_variable_paise,
           o.joining_date::text AS joining_date, o.offer_expires_at, e.brand_name AS brand
      FROM app.onboarding_case o
      JOIN app.application a ON a.id=o.application_id
      JOIN app.job j ON j.id=a.job_id
      JOIN app.employer_organisation e ON e.id=j.employer_id
     WHERE a.candidate_id=${candidateId} ORDER BY o.created_at DESC`;

  const docs = await sql<{
    id: string; document_key: string; status: string; reject_reason: string | null; case_id: string;
  }[]>`
    SELECT d.id, d.document_key, d.status, d.reject_reason, d.onboarding_case_id AS case_id
      FROM app.candidate_document d WHERE d.candidate_id=${candidateId} ORDER BY d.document_key`;

  const messages = await sql<{
    id: string; direction: string; body: string; category: string | null; created_at: Date;
  }[]>`
    SELECT id, direction, body, category, created_at FROM app.message_log
     WHERE candidate_id=${candidateId} ORDER BY created_at DESC, id DESC LIMIT 30`;

  return (
    <>
      <SubNav tabs={CANDIDATE_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>Alerts &amp; messages</h1>
              <div className="sub">
                What the candidate actually receives, and the actions offered in each message
                {' '}<Clause>ALT-04 · INT-02 · ONB-02</Clause>
              </div>
            </div>
            <CandidatePicker candidates={all} current={candidateId} base="/wa/inbox" />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Job alerts</h2><Clause>ALT-01/04</Clause></div>
          <div className="card-body tight">
            {alerts.length === 0
              ? <div className="empty">No alerts. Approve a job in Operations to dispatch them.</div>
              : <div className="tblwrap"><table>
                  <thead><tr><th>Job</th><th>Employer</th><th>Sent</th><th>Response</th><th className="right">Actions</th></tr></thead>
                  <tbody>{alerts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.title}<div className="small muted">{a.loc}</div></td>
                      <td className="small">{a.brand}</td>
                      <td className="small muted">{fmtDateTime(a.sent_at)}</td>
                      <td>{a.response
                        ? <span className="pill p-info">{a.response.replace(/_/g, ' ').toLowerCase()}</span>
                        : <span className="pill p-mute">no reply</span>}</td>
                      <td className="right">
                        <AlertActions alertId={a.id} candidateId={candidateId} jobId={a.job_id}
                                      alreadyApplied={a.applied} responded={!!a.response} />
                      </td>
                    </tr>
                  ))}</tbody>
                </table></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Interview invitations</h2><Clause>INT-02</Clause></div>
          <div className="card-body tight">
            {interviews.length === 0 ? <div className="empty">No invitations.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Employer</th><th>When</th><th>Where</th><th>Status</th><th className="right">Reply</th></tr></thead>
                <tbody>{interviews.map((i) => (
                  <tr key={i.id}>
                    <td>{i.brand}<div className="small muted">{i.title}</div></td>
                    <td className="small">{fmtDateTime(i.scheduled_at)}</td>
                    <td className="small">{i.location_note}
                      {i.safety_note && <div className="muted small">{i.safety_note}</div>}</td>
                    <td><span className="pill p-mute">{i.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="right">
                      {['PROPOSED', 'RESCHEDULED'].includes(i.status)
                        ? <InterviewReply interviewId={i.id} />
                        : <span className="small muted">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Offers</h2><Clause>ONB-02</Clause></div>
          <div className="card-body tight">
            {offers.length === 0 ? <div className="empty">No offers.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Employer</th><th>Role</th><th>Pay</th><th>Joining</th><th>Status</th><th className="right">Reply</th></tr></thead>
                <tbody>{offers.map((o) => (
                  <tr key={o.id}>
                    <td>{o.brand}</td>
                    <td className="small">{o.role_title}</td>
                    <td className="small mono">
                      ₹{Number(o.offer_fixed_paise) / 100} fixed
                      {Number(o.offer_variable_paise) > 0 &&
                        <div className="muted">+ up to ₹{Number(o.offer_variable_paise) / 100}</div>}
                    </td>
                    <td className="small">{o.joining_date}
                      <div className="muted small">reply by {fmtDateTime(o.offer_expires_at)}</div></td>
                    <td><span className="pill p-mute">{o.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="right">
                      {o.status === 'OFFER_SENT'
                        ? <OfferReply caseId={o.id} />
                        : <span className="small muted">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>

        {docs.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Documents to upload</h2><Clause>ONB-04</Clause></div>
            <div className="card-body tight"><div className="tblwrap">
              <table>
                <thead><tr><th>Document</th><th>Status</th><th>Note</th><th className="right">Upload</th></tr></thead>
                <tbody>{docs.map((d) => (
                  <tr key={d.id}>
                    <td className="small">{d.document_key.replace(/_/g, ' ')}</td>
                    <td><span className={`pill ${d.status === 'APPROVED' ? 'p-ok' : d.status === 'REJECTED' ? 'p-bad' : d.status === 'UPLOADED' ? 'p-info' : 'p-mute'}`}>
                      {d.status.toLowerCase()}</span></td>
                    <td className="small muted">{d.reject_reason ?? ''}</td>
                    <td className="right">
                      {['PENDING', 'REJECTED'].includes(d.status)
                        ? <DocUpload documentId={d.id} />
                        : <span className="small muted">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="note small" style={{ margin: 14 }}>
              Uploads go to secure storage the employer can only reach for this case. Partners can
              never see them. In this prototype the file is a watermarked placeholder — no real
              document exists anywhere.
            </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><h2>Message log</h2><Clause>§10.1</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>When</th><th>Dir</th><th>Category</th><th>Message</th><th className="num">Cost model</th></tr></thead>
              <tbody>{messages.map((m) => (
                <tr key={m.id}>
                  <td className="small muted">{fmtDateTime(m.created_at)}</td>
                  <td className="small">{m.direction === 'INBOUND' ? '← in' : '→ out'}</td>
                  <td className="small">{m.category?.toLowerCase() ?? 'inbound'}</td>
                  <td className="small">{m.body}</td>
                  <td className="num small muted">
                    {m.category === 'MARKETING' ? '₹0.86' : !m.category || m.category === 'SERVICE' ? 'free' : '₹0.12'}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        </div>
      </main>
    </>
  );
}
