import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { formatPay } from '@/lib/money';

import { StatusPill, Clause } from '../../ui';
import { SubNav, EMPLOYER_TABS } from '../../subnav';
import { AddLocation } from '../employer-tools';
import { JobLifecycle } from './job-lifecycle';

export const dynamic = 'force-dynamic';

export default async function EmployerJobsPage() {
  const viewer=await scopePage('employer');
  const employerId = viewer.role==='ADMIN' ? 'EMP-001' : viewer.id;

  const jobs = await sql<{
    id: string; title: string; status: string; status_reason: string | null; openings: number;
    loc: string; location_id: string; fixed_pay_paise: string; variable_max_paise: string;
    shift: string; expires_at: Date | null; ent_id: string | null;
    qualified: string; unlocked: string; alerts: string; duplicated_from: string | null;
  }[]>`
    SELECT j.id, j.title, j.status, j.status_reason, j.openings, l.name AS loc, j.location_id,
           j.fixed_pay_paise, j.variable_max_paise, j.shift, j.expires_at, j.duplicated_from,
           e.id AS ent_id,
           (SELECT COUNT(*)::text FROM app.match_result m
             JOIN app.application a ON a.id=m.application_id
            WHERE m.job_id=j.id AND m.qualified AND a.reconfirmed_at IS NOT NULL
              AND a.status NOT IN ('WITHDRAWN','REJECTED')) AS qualified,
           (SELECT COUNT(*)::text FROM app.qualified_lead_unlock u
             WHERE u.job_id=j.id AND u.status='CONFIRMED') AS unlocked,
           (SELECT COUNT(*)::text FROM app.job_alert a WHERE a.job_id=j.id) AS alerts
      FROM app.job j
      JOIN app.employer_location l ON l.id=j.location_id
 LEFT JOIN app.posting_entitlement e ON e.job_id=j.id
     WHERE j.employer_id=${employerId}
     ORDER BY (j.status='LIVE') DESC, j.id`;

  const totals = await sql`SELECT e.job_id,COALESCE(SUM(c.credit_delta),0) AS available FROM app.posting_entitlement e JOIN app.job j ON j.id=e.job_id LEFT JOIN app.credit_ledger c ON c.entitlement_id=e.id WHERE j.employer_id=${employerId} GROUP BY e.job_id`;
  const balances=new Map(totals.map(row=>[String(row.job_id),Number(row.available)]));

  const localities = await sql<{ key: string; display_name: string }[]>`
    SELECT key, display_name FROM app.locality ORDER BY display_name`;

  return (
    <>
      <SubNav tabs={EMPLOYER_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>Jobs</h1>
              <div className="sub">
                Draft, publish, pause, close, duplicate and archive <Clause>JOB-01 / 04 / 05</Clause>
              </div>
            </div>
            <div className="btnrow">
              <AddLocation employerId={employerId} localities={localities} />
              <Link className="btn btn-primary" href="/employer/new-job">+ Post a job</Link>
            </div>
          </div>
        </div>

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>Job</th><th>Branch</th><th>Pay</th><th className="num">Open</th>
              <th className="num">Qualified</th><th className="num">Alerts</th><th className="num">Credits</th>
              <th>Expires</th><th>Status</th><th className="right">Manage</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><span className="id">{j.id}</span><br /><strong>{j.title}</strong>
                    {j.duplicated_from && <div className="small muted">copy of {j.duplicated_from}</div>}</td>
                  <td className="small">{j.loc}<div className="muted mono">{j.shift}</div></td>
                  <td className="small">{formatPay(Number(j.fixed_pay_paise), Number(j.variable_max_paise))}</td>
                  <td className="num">{j.openings}</td>
                  <td className="num">{j.qualified}<div className="small muted">{j.unlocked} unlocked</div></td>
                  <td className="num">{j.alerts}</td>
                  <td className="num">{balances.has(j.id) ? balances.get(j.id) : '—'}</td>
                  <td className="small muted">{fmtDateTime(j.expires_at)}</td>
                  <td><StatusPill status={j.status} />
                    {j.status_reason && <div className="small muted">{j.status_reason}</div>}</td>
                  <td className="right">
                    <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
                      {j.status === 'LIVE' && (
                        <Link className="btn btn-sm btn-primary" href={`/employer/job/${j.id}`}>Shortlist</Link>
                      )}
                      <JobLifecycle jobId={j.id} status={j.status}
                                    fixedRupees={Number(j.fixed_pay_paise) / 100}
                                    variableRupees={Number(j.variable_max_paise) / 100}
                                    openings={j.openings} title={j.title} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>

        <div className="note mt">
          Editing pay, branch, timing or requirements is a <strong>material</strong> change: it
          re-validates open matches and notifies every candidate already interested. Editing the
          title is not. <Clause>JOB-04</Clause>
        </div>
      </main>
    </>
  );
}
