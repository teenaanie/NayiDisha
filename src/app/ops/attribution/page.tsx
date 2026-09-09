import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { OpsActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function AttributionPage() {
  const rows = await sql<{
    id: string; candidate_id: string; name: string | null; partner_id: string | null;
    partner_name: string | null; partner_site_id: string | null; method: string;
    status: string; status_reason: string | null; bound_at: Date; expires_at: Date;
    unlocks: string;
  }[]>`
    SELECT a.id, a.candidate_id, c.name, a.partner_id, p.name AS partner_name,
           a.partner_site_id, a.method, a.status, a.status_reason, a.bound_at, a.expires_at,
           (SELECT COUNT(*)::text FROM app.qualified_lead_unlock u
             WHERE u.candidate_id = a.candidate_id AND u.status='CONFIRMED') AS unlocks
      FROM app.attribution a
      JOIN app.candidate c ON c.id = a.candidate_id
 LEFT JOIN app.partner p ON p.id = a.partner_id
     ORDER BY (a.status <> 'ACTIVE') DESC, a.id`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Attribution</h1>
          <div className="sub">
            One acquisition partner per candidate, bound at first verified registration and never
            overwritten by a later scan <Clause>§8.11 REF-01 / REF-02</Clause>
          </div>
        </div>
        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>Candidate</th><th>Partner</th><th>Method</th><th>Bound</th><th>Window ends</th>
              <th className="num">Unlocks</th><th>Status</th><th className="right">Action</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><span className="id">{a.candidate_id}</span><div className="small">{a.name}</div></td>
                  <td className="small">{a.partner_name ?? <span className="muted">direct</span>}
                    <div className="id">{a.partner_site_id ?? ''}</div></td>
                  <td className="small">{a.method.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="small muted">{fmtDateTime(a.bound_at)}</td>
                  <td className="small muted">{fmtDateTime(a.expires_at)}</td>
                  <td className="num">{a.unlocks}</td>
                  <td><StatusPill status={a.status} />
                    {a.status_reason && <div className="small muted">{a.status_reason}</div>}</td>
                  <td className="right">
                    {a.status === 'UNDER_REVIEW' && <OpsActions kind="attribution" id={a.id} status={a.status} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>
      </main>
    </>
  );
}
