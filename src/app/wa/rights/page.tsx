import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { Clause, StatusPill } from '../../ui';
import { SubNav, CANDIDATE_TABS } from '../../subnav';
import { CandidatePicker, DataRequestForm } from '../candidate-client';

export const dynamic = 'force-dynamic';

export default async function RightsPage({
  searchParams,
}: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const candidateId = c ?? 'CAN-001';

  const all = await sql<{ id: string; name: string | null }[]>`
    SELECT id, name FROM app.candidate WHERE status='PROFILE_ACTIVE' ORDER BY id`;

  const consents = await sql<{
    purpose: string; notice_version: string; channel: string;
    granted_at: Date | null; withdrawn_at: Date | null;
  }[]>`SELECT * FROM app.consent_record WHERE candidate_id=${candidateId} ORDER BY purpose`;

  const requests = await sql<{
    id: string; kind: string; detail: string | null; status: string;
    due_at: Date; created_at: Date; resolved_at: Date | null;
  }[]>`SELECT * FROM app.data_request WHERE candidate_id=${candidateId} ORDER BY created_at DESC`;

  const shared = await sql<{
    id: string; brand: string; job_title: string; unlocked_at: Date;
  }[]>`
    SELECT u.id, e.brand_name AS brand, j.title AS job_title, u.unlocked_at
      FROM app.qualified_lead_unlock u
      JOIN app.job j ON j.id=u.job_id
      JOIN app.employer_organisation e ON e.id=u.employer_id
     WHERE u.candidate_id=${candidateId} AND u.status='CONFIRMED'
     ORDER BY u.unlocked_at DESC`;

  const PURPOSE_LABEL: Record<string, string> = {
    PROCESSING: 'Store my profile and show me jobs',
    JOB_ALERTS: 'Send me job alerts',
    PARTNER_ASSISTANCE: 'Let the shop that referred me help me',
    DOCUMENTS: 'Collect my documents for onboarding',
    PRECISE_LOCATION: 'Use my exact location',
  };

  return (
    <>
      <SubNav tabs={CANDIDATE_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>My data</h1>
              <div className="sub">
                Every purpose is a separate permission that can be withdrawn on its own
                {' '}<Clause>CAN-05 / CAN-06 / CAN-09</Clause>
              </div>
            </div>
            <CandidatePicker candidates={all} current={candidateId} base="/wa/rights" />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>What I have agreed to</h2><Clause>§12 ConsentRecord</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Purpose</th><th>Notice</th><th>Given</th><th>Withdrawn</th><th>State</th></tr></thead>
              <tbody>{consents.map((c) => (
                <tr key={c.purpose}>
                  <td>{PURPOSE_LABEL[c.purpose] ?? c.purpose}
                    <div className="id small">{c.purpose}</div></td>
                  <td className="small mono">{c.notice_version}</td>
                  <td className="small muted">{fmtDateTime(c.granted_at)}</td>
                  <td className="small muted">{fmtDateTime(c.withdrawn_at)}</td>
                  <td>{c.withdrawn_at
                    ? <span className="pill p-bad">withdrawn</span>
                    : c.granted_at ? <span className="pill p-ok">active</span>
                    : <span className="pill p-mute">not given</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Who has seen my profile</h2><Clause>CAN-09</Clause></div>
          <div className="card-body tight">
            {shared.length === 0
              ? <div className="empty">No employer has opened your profile.</div>
              : <div className="tblwrap"><table>
                  <thead><tr><th>Employer</th><th>Role</th><th>When</th></tr></thead>
                  <tbody>{shared.map((s) => (
                    <tr key={s.id}>
                      <td>{s.brand}</td>
                      <td className="small">{s.job_title}</td>
                      <td className="small muted">{fmtDateTime(s.unlocked_at)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>}
            <div className="note small" style={{ margin: 14 }}>
              You are told every time an employer opens your profile — and told that nobody may ever
              ask you for money.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Raise a request</h2><Clause>CAN-06</Clause></div>
          <div className="card-body"><DataRequestForm candidateId={candidateId} /></div>
        </div>

        {requests.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>My requests</h2></div>
            <div className="card-body tight"><div className="tblwrap">
              <table>
                <thead><tr><th>Request</th><th>Kind</th><th>Detail</th><th>Raised</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>{requests.map((r) => (
                  <tr key={r.id}>
                    <td className="id">{r.id}</td>
                    <td><span className="pill p-info">{r.kind.toLowerCase()}</span></td>
                    <td className="small">{r.detail}</td>
                    <td className="small muted">{fmtDateTime(r.created_at)}</td>
                    <td className="small muted">{fmtDateTime(r.due_at)}</td>
                    <td><StatusPill status={r.status} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div></div>
          </div>
        )}
      </main>
    </>
  );
}
