import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { formatPay } from '@/lib/money';
import { creditBalance, reconcileEntitlement } from '@/modules/commercial';
import { StatusPill, Clause, Money, Stat } from '../ui';

export const dynamic = 'force-dynamic';

export default async function EmployerPage() {
  const employerId = 'EMP-001'; // demo persona: DEMO Asha Kulkarni, company admin

  const [emp] = await sql<{ brand_name: string; status: string }[]>`
    SELECT brand_name, status FROM app.employer_organisation WHERE id=${employerId}`;

  const jobs = await sql<{
    id: string; title: string; status: string; openings: number; loc: string;
    fixed_pay_paise: string; variable_max_paise: string; shift: string;
    expires_at: Date | null; ent_id: string | null; qualified: string; unlocked: string;
  }[]>`
    SELECT j.id, j.title, j.status, j.openings, l.name AS loc,
           j.fixed_pay_paise, j.variable_max_paise, j.shift, j.expires_at,
           e.id AS ent_id,
           (SELECT COUNT(*)::text FROM app.match_result m
             JOIN app.application a ON a.id=m.application_id
            WHERE m.job_id=j.id AND m.qualified AND a.reconfirmed_at IS NOT NULL
              AND a.status NOT IN ('WITHDRAWN','REJECTED')) AS qualified,
           (SELECT COUNT(*)::text FROM app.qualified_lead_unlock u
             WHERE u.job_id=j.id AND u.status='CONFIRMED') AS unlocked
      FROM app.job j
      JOIN app.employer_location l ON l.id=j.location_id
 LEFT JOIN app.posting_entitlement e ON e.job_id=j.id
     WHERE j.employer_id=${employerId}
     ORDER BY (j.status='LIVE') DESC, j.id`;

  const balances = new Map<string, Awaited<ReturnType<typeof creditBalance>>>();
  const recon = new Map<string, Awaited<ReturnType<typeof reconcileEntitlement>>>();
  for (const jb of jobs) {
    if (jb.ent_id) {
      balances.set(jb.id, await creditBalance(jb.ent_id));
      recon.set(jb.id, await reconcileEntitlement(jb.ent_id));
    }
  }

  const totals = [...balances.values()].reduce(
    (a, b) => ({ available: a.available + b.available, consumed: a.consumed + b.consumed }),
    { available: 0, consumed: 0 },
  );

  const outcomes = await sql<{
    application_id: string; candidate_id: string; job_id: string; outcome: string; created_at: Date;
  }[]>`
    SELECT o.application_id, a.candidate_id, a.job_id, o.outcome, o.created_at
      FROM app.optional_outcome_event o JOIN app.application a ON a.id=o.application_id
     ORDER BY o.created_at DESC LIMIT 10`;

  return (
    <main className="page">
      <div className="page-head">
        <h1>{emp.brand_name}</h1>
        <div className="sub">
          Signed in as DEMO Asha Kulkarni · Company administrator <Clause>§10.3</Clause>
        </div>
      </div>

      <div className="grid g3 mb">
        <Stat k="Live vacancies" v={jobs.filter((j) => j.status === 'LIVE').length} />
        <Stat k="Unlock credits available" v={totals.available} d={`${totals.consumed} consumed`} />
        <Stat k="Qualified profiles waiting" v={jobs.reduce((a, j) => a + Number(j.qualified), 0)} d="reconfirmed and unlockable" />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Jobs and posting entitlements</h2>
          <Clause>JOB-07 · §9.3</Clause>
        </div>
        <div className="card-body tight">
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th><th>Location</th><th>Pay</th><th className="num">Openings</th>
                  <th className="num">Qualified</th><th className="num">Credits</th>
                  <th>Expires</th><th>Status</th><th className="right"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((jb) => {
                  const b = balances.get(jb.id);
                  const r = recon.get(jb.id);
                  return (
                    <tr key={jb.id}>
                      <td><span className="id">{jb.id}</span><br />{jb.title}</td>
                      <td className="small">{jb.loc}<br /><span className="muted mono">{jb.shift}</span></td>
                      <td className="small">{formatPay(Number(jb.fixed_pay_paise), Number(jb.variable_max_paise))}</td>
                      <td className="num">{jb.openings}</td>
                      <td className="num">{jb.qualified}</td>
                      <td className="num">
                        {b ? <>{b.available}<span className="muted"> / {b.granted + b.purchased}</span></> : '—'}
                        {r && !r.balances && <div><span className="pill p-bad">ledger mismatch</span></div>}
                      </td>
                      <td className="small muted">{fmtDateTime(jb.expires_at)}</td>
                      <td><StatusPill status={jb.status} /></td>
                      <td className="right">
                        {jb.status === 'LIVE'
                          ? <Link className="btn btn-sm btn-primary" href={`/employer/job/${jb.id}`}>Shortlist</Link>
                          : <span className="muted small">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h3>Credit reconciliation</h3><Clause>§25</Clause></div>
          <div className="card-body tight">
            <div className="tblwrap">
              <table>
                <thead><tr><th>Job</th><th className="num">Granted</th><th className="num">Purchased</th><th className="num">Unlocks</th><th className="num">Restored</th><th className="num">Closing</th><th>Check</th></tr></thead>
                <tbody>
                  {[...recon.entries()].map(([jobId, r]) => (
                    <tr key={jobId}>
                      <td className="id">{jobId}</td>
                      <td className="num">{r.granted}</td>
                      <td className="num">{r.purchased}</td>
                      <td className="num">−{r.unlocks}</td>
                      <td className="num">+{r.adjustments}</td>
                      <td className="num"><strong>{r.closing}</strong></td>
                      <td>{r.balances && r.unlocksMatchLedger
                        ? <span className="pill p-ok">balanced</span>
                        : <span className="pill p-bad">mismatch</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note small" style={{ margin: 14 }}>
              opening + credits − unlocks ± adjustments = closing, verified per entitlement on every render.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Recorded outcomes</h3><Clause>LEAD-10 · optional</Clause></div>
          <div className="card-body tight">
            {outcomes.length === 0
              ? <div className="empty">No outcomes recorded. Billing and partner rewards close without them.</div>
              : <div className="tblwrap"><table>
                  <thead><tr><th>Candidate</th><th>Job</th><th>Outcome</th><th>When</th></tr></thead>
                  <tbody>
                    {outcomes.map((o, i) => (
                      <tr key={i}>
                        <td className="id">{o.candidate_id}</td>
                        <td className="id">{o.job_id}</td>
                        <td><span className="pill p-info">{o.outcome.replace(/_/g, ' ')}</span></td>
                        <td className="small muted">{fmtDateTime(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>}
          </div>
        </div>
      </div>
    </main>
  );
}
