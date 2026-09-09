import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause, Money } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { OpsActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function ReplacementsPage() {
  const rows = await sql<{
    id: string; unlock_id: string; reason_code: string; evidence: string; decision: string;
    raised_at: Date; window_ends_at: Date; decided_at: Date | null; decided_by: string | null;
    candidate_id: string; job_id: string; employer_id: string; price_paise: string;
    partner_id: string | null;
  }[]>`
    SELECT r.*, u.candidate_id, u.job_id, u.employer_id, u.price_paise, u.attributed_partner_id AS partner_id
      FROM app.replacement_case r
      JOIN app.qualified_lead_unlock u ON u.id = r.unlock_id
     ORDER BY (r.decision='PENDING') DESC, r.raised_at DESC`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Invalid-lead replacements</h1>
          <div className="sub">
            Approval restores the employer credit and reverses the partner reward through linked
            correction rows. &ldquo;Did not pass our interview&rdquo; is not a valid reason.
            {' '}<Clause>LEAD-08 / LEAD-09 / §9.3</Clause>
          </div>
        </div>
        <div className="card"><div className="card-body tight">
          {rows.length === 0 ? <div className="empty">No claims raised.</div> : (
            <div className="tblwrap">
              <table>
                <thead><tr>
                  <th>Case</th><th>Unlock</th><th>Reason &amp; evidence</th><th>Window</th>
                  <th className="num">Value</th><th>Decision</th><th className="right">Action</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="id">{r.id}<div className="small muted">{fmtDateTime(r.raised_at)}</div></td>
                      <td className="id">{r.unlock_id}
                        <div className="small muted">{r.candidate_id} · {r.job_id}</div></td>
                      <td className="small"><strong>{r.reason_code.replace(/_/g, ' ').toLowerCase()}</strong>
                        <div className="muted">{r.evidence}</div></td>
                      <td className="small muted">closes {fmtDateTime(r.window_ends_at)}</td>
                      <td className="num"><Money paise={r.price_paise} /></td>
                      <td><StatusPill status={r.decision} />
                        {r.decided_by && <div className="small muted">by {r.decided_by}</div>}</td>
                      <td className="right">
                        {r.decision === 'PENDING' && <OpsActions kind="replacement" id={r.id} status={r.decision} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div></div>
      </main>
    </>
  );
}
