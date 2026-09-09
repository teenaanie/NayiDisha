import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { DataRequestActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function DataRequestsPage() {
  const viewer=await scopePage('ops');
  const rows = await sql<{
    id: string; candidate_id: string; name: string | null; kind: string; detail: string | null;
    status: string; due_at: Date; created_at: Date; resolved_at: Date | null; days_left: number;
  }[]>`
    SELECT r.*, c.name,
           EXTRACT(DAY FROM (r.due_at - (SELECT now_at FROM app.demo_clock WHERE id=1)))::int AS days_left
      FROM app.data_request r JOIN app.candidate c ON c.id = r.candidate_id
     ORDER BY (r.status='OPEN') DESC, r.due_at ASC`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Data principal requests</h1><p className="note">Candidates create requests from My data. Access produces a private export; erasure anonymises profile data while retaining necessary transaction history. Corrections require a specific field and value.</p>
          <div className="sub">
            Access, correction and erasure. The DPDP Rules require a response within 90 days, so the
            due date is stored on the row and this queue sorts by what is closest to breaching.
            {' '}<Clause>CAN-06 · §14 Privacy</Clause>
          </div>
        </div>
        <div className="card"><div className="card-body tight">
          {rows.length === 0
            ? <div className="empty">No requests. A candidate raises one from the &ldquo;My data&rdquo; tab.</div>
            : <div className="tblwrap">
                <table>
                  <thead><tr>
                    <th>Request</th><th>Candidate</th><th>Kind</th><th>Detail</th>
                    <th>Due</th><th>Status</th><th className="right">Action</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="id">{r.id}<div className="small muted">{fmtDateTime(r.created_at)}</div></td>
                        <td><span className="id">{r.candidate_id}</span><div className="small">{r.name}</div></td>
                        <td><span className="pill p-info">{r.kind.toLowerCase()}</span></td>
                        <td className="small">{r.detail}</td>
                        <td className="small">
                          {fmtDateTime(r.due_at)}
                          {r.status === 'OPEN' && (
                            <div className={r.days_left < 30 ? 'pill p-warn' : 'small muted'}>
                              {r.days_left} days left
                            </div>
                          )}
                        </td>
                        <td><StatusPill status={r.status} /></td>
                        <td className="right">
                          {r.status === 'OPEN' && <DataRequestActions id={r.id} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </div></div>
      </main>
    </>
  );
}
