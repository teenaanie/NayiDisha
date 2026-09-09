import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { formatPay } from '@/lib/money';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { OpsActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function JobModerationPage() {
  const viewer=await scopePage('ops');
  const jobs = await sql<{
    id: string; title: string; brand: string; loc: string; status: string; openings: number;
    fixed_pay_paise: string; variable_max_paise: string; expires_at: Date | null;
    config: string; status_reason: string | null; alerts: string; partner_alerts: string;
  }[]>`
    SELECT j.id, j.title, e.brand_name AS brand, l.name AS loc, j.status, j.openings,
           j.fixed_pay_paise, j.variable_max_paise, j.expires_at, j.role_config_id AS config,
           j.status_reason,
           (SELECT COUNT(*)::text FROM app.job_alert a WHERE a.job_id=j.id) AS alerts,
           (SELECT COUNT(*)::text FROM app.partner_job_alert a WHERE a.job_id=j.id) AS partner_alerts
      FROM app.job j
      JOIN app.employer_organisation e ON e.id=j.employer_id
      JOIN app.employer_location l ON l.id=j.location_id
     ORDER BY (j.status='PENDING_APPROVAL') DESC, j.id`;

  const changes = await sql<{
    id: string; job_id: string; field: string; old_value: string | null; new_value: string | null;
    material: boolean; notified_count: number; created_at: Date;
  }[]>`SELECT * FROM app.job_change ORDER BY created_at DESC LIMIT 15`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Job moderation</h1>
          <div className="sub">
            Approval publishes the job, starts its 30-day clock, issues the entitlement and
            dispatches alerts <Clause>JOB-02 / JOB-03 / ALT-01</Clause>
          </div>
        </div>

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>ID</th><th>Job</th><th>Employer</th><th>Pay</th><th>Config</th>
              <th className="num">Alerts</th><th>Expires</th><th>Status</th><th className="right">Action</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="id">{j.id}</td>
                  <td>{j.title}<div className="small muted">{j.loc}</div></td>
                  <td className="small">{j.brand}</td>
                  <td className="small">{formatPay(Number(j.fixed_pay_paise), Number(j.variable_max_paise))}</td>
                  <td className="id">{j.config}</td>
                  <td className="num">{j.alerts}<div className="small muted">{j.partner_alerts} partner</div></td>
                  <td className="small muted">{fmtDateTime(j.expires_at)}</td>
                  <td><StatusPill status={j.status} />
                    {j.status_reason && <div className="small muted">{j.status_reason}</div>}</td>
                  <td className="right"><OpsActions kind="job" id={j.id} status={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>

        <div className="card">
          <div className="card-head"><h2>Recent job changes</h2><Clause>JOB-04</Clause></div>
          <div className="card-body tight">
            {changes.length === 0 ? <div className="empty">No edits recorded.</div> : (
              <div className="tblwrap">
                <table>
                  <thead><tr><th>Job</th><th>Field</th><th>From → to</th><th>Material</th><th className="num">Notified</th><th>When</th></tr></thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.id}>
                        <td className="id">{c.job_id}</td>
                        <td className="small">{c.field.replace(/_/g, ' ')}</td>
                        <td className="small mono">{c.old_value} → {c.new_value}</td>
                        <td>{c.material
                          ? <span className="pill p-warn">material</span>
                          : <span className="pill p-mute">minor</span>}</td>
                        <td className="num">{c.notified_count}</td>
                        <td className="small muted">{fmtDateTime(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="note small" style={{ margin: 14 }}>
              Pay, location, timing and requirements are material: changing one notifies every
              candidate already interested. Changing a title does not.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
