import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { maskName } from '@/modules/matching';
import { Clause, StatusPill } from '../../ui';
import { SubNav, PARTNER_TABS } from '../../subnav';
import { NudgeButton } from '../partner-client';

export const dynamic = 'force-dynamic';

export default async function PartnerCandidatesPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const viewer=await scopePage('partner');
  const { p } = await searchParams;
  const partnerId = viewer.role==='ADMIN' ? (p ?? 'PAR-001') : viewer.id;

  const rows = await sql<{
    candidate_id: string; name: string | null; locality_key: string | null; status: string;
    assisted: boolean; attr_status: string; bound_at: Date;
    applications: string; qualified: string; unlocked: string; nudges_week: string;
  }[]>`
    SELECT c.id AS candidate_id, c.name, c.locality_key, c.status, a.status AS attr_status, a.bound_at,
      COALESCE((SELECT cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL FROM app.consent_record cr
                 WHERE cr.candidate_id=c.id AND cr.purpose='PARTNER_ASSISTANCE'), FALSE) AS assisted,
      (SELECT COUNT(*)::text FROM app.application ap WHERE ap.candidate_id=c.id) AS applications,
      (SELECT COUNT(*)::text FROM app.match_result m WHERE m.candidate_id=c.id AND m.qualified) AS qualified,
      (SELECT COUNT(*)::text FROM app.qualified_lead_unlock u
        WHERE u.candidate_id=c.id AND u.status='CONFIRMED') AS unlocked,
      (SELECT COUNT(*)::text FROM app.partner_nudge n WHERE n.candidate_id=c.id
        AND n.created_at > (SELECT now_at FROM app.demo_clock WHERE id=1) - interval '7 days') AS nudges_week
    FROM app.attribution a JOIN app.candidate c ON c.id=a.candidate_id
    WHERE a.partner_id=${partnerId} AND EXISTS (SELECT 1 FROM app.consent_record cr WHERE cr.candidate_id=c.id AND cr.purpose='PARTNER_ASSISTANCE' AND cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL) ORDER BY a.bound_at`;

  const liveJobs = await sql<{ id: string; title: string; brand: string }[]>`
    SELECT j.id, j.title, e.brand_name AS brand FROM app.job j
      JOIN app.employer_organisation e ON e.id=j.employer_id
     WHERE j.status='LIVE' ORDER BY j.id`;

  const nudges = await sql<{
    id: string; candidate_id: string; job_id: string | null; template_key: string; created_at: Date;
  }[]>`SELECT * FROM app.partner_nudge WHERE partner_id=${partnerId} ORDER BY created_at DESC LIMIT 20`;

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>My candidates</h1>
          <div className="sub">
            Only people who consented to your assistance, with contact details masked throughout
            {' '}<Clause>PART-08 / PART-09 / ALT-05</Clause>
          </div>
        </div>

        <div className="card"><div className="card-body tight">
          {rows.length === 0 ? <div className="empty">No attributed candidates yet.</div> : (
            <div className="tblwrap">
              <table>
                <thead><tr>
                  <th>Candidate</th><th>Locality</th><th>Assist</th><th className="num">Apps</th>
                  <th className="num">Qualified</th><th className="num">Unlocked</th>
                  <th>Referral status</th><th className="right">Nudge</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.candidate_id}>
                      <td><strong>{maskName(r.name)}</strong>
                        <div className="small muted">contact masked from partners</div></td>
                      <td className="small">{r.locality_key?.replace(/_/g, ' ') ?? '—'}</td>
                      <td>{r.assisted
                        ? <span className="pill p-ok">consented</span>
                        : <span className="pill p-mute">not consented</span>}</td>
                      <td className="num">{r.applications}</td>
                      <td className="num">{r.qualified}</td>
                      <td className="num">{r.unlocked}</td>
                      <td><StatusPill status={r.attr_status} />
                        <div className="small muted">{fmtDateTime(r.bound_at)}</div></td>
                      <td className="right">
                        <NudgeButton partnerId={partnerId} candidateId={r.candidate_id}
                                     jobs={liveJobs} disabled={!r.assisted}
                                     usedThisWeek={Number(r.nudges_week)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="note small" style={{ margin: 14 }}>
            You cannot write the message. Nudges use a platform template, are rate-limited to two per
            candidate per week, and are logged — so misleading pay claims and job guarantees are
            impossible rather than merely forbidden. <Clause>ALT-06</Clause>
          </div>
        </div></div>

        {nudges.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Nudge history</h2></div>
            <div className="card-body tight"><div className="tblwrap">
              <table>
                <thead><tr><th>When</th><th>Candidate</th><th>Job</th><th>Template</th></tr></thead>
                <tbody>{nudges.map((n) => (
                  <tr key={n.id}>
                    <td className="small muted">{fmtDateTime(n.created_at)}</td>
                    <td className="id">{n.candidate_id}</td>
                    <td className="id">{n.job_id ?? '—'}</td>
                    <td className="small mono">{n.template_key}</td>
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
