import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause, Money, Tags } from '../ui';
import { OpsActions, ConfigPanel, SandboxEditor } from './ops-client';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const employers = await sql<{ id: string; brand_name: string; status: string; jobs: string }[]>`
    SELECT e.id, e.brand_name, e.status,
           (SELECT COUNT(*)::text FROM app.job j WHERE j.employer_id=e.id) AS jobs
      FROM app.employer_organisation e ORDER BY e.id`;

  const partners = await sql<{
    id: string; name: string; partner_type: string; status: string; pan: string | null;
    sites: string; code: string | null;
  }[]>`
    SELECT p.id, p.name, p.partner_type, p.status, p.pan,
           (SELECT COUNT(*)::text FROM app.partner_site s WHERE s.partner_id=p.id) AS sites,
           (SELECT s.partner_code FROM app.partner_site s WHERE s.partner_id=p.id LIMIT 1) AS code
      FROM app.partner p ORDER BY p.id`;

  const jobs = await sql<{
    id: string; title: string; brand: string; status: string; openings: number;
    expires_at: Date | null; config: string;
  }[]>`
    SELECT j.id, j.title, e.brand_name AS brand, j.status, j.openings, j.expires_at,
           j.role_config_id AS config
      FROM app.job j JOIN app.employer_organisation e ON e.id=j.employer_id ORDER BY j.id`;

  const configs = await sql<{
    id: string; industry_key: string; role_family_key: string; version: string; status: string;
    assessment_threshold: number | null; scoring_weights: Record<string, number>;
  }[]>`SELECT * FROM app.role_configuration ORDER BY id`;

  const attributions = await sql<{
    id: string; candidate_id: string; name: string | null; partner_id: string | null;
    method: string; status: string; status_reason: string | null; bound_at: Date;
  }[]>`
    SELECT a.id, a.candidate_id, c.name, a.partner_id, a.method, a.status, a.status_reason, a.bound_at
      FROM app.attribution a JOIN app.candidate c ON c.id=a.candidate_id
     ORDER BY (a.status <> 'ACTIVE') DESC, a.id`;

  const fraud = await sql<{
    id: string; subject_type: string; subject_id: string; signal: string; status: string; created_at: Date;
  }[]>`SELECT * FROM app.fraud_case ORDER BY created_at DESC`;

  const replacements = await sql<{
    id: string; unlock_id: string; reason_code: string; evidence: string; decision: string;
    window_ends_at: Date; candidate_id: string;
  }[]>`
    SELECT r.*, u.candidate_id FROM app.replacement_case r
      JOIN app.qualified_lead_unlock u ON u.id = r.unlock_id ORDER BY r.raised_at DESC`;

  const audit = await sql<{
    id: string; actor: string; actor_role: string; event: string; entity_id: string | null;
    reason: string | null; created_at: Date;
  }[]>`SELECT * FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT 25`;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Operations console</h1>
        <div className="sub">Verification queues, configuration publishing, attribution disputes, fraud cases and audit <Clause>§10.5</Clause></div>
      </div>

      <ConfigPanel configs={configs} />
      <SandboxEditor configs={configs.filter((c) => c.status === 'SANDBOX' || c.status === 'DRAFT')} />

      <div className="card">
        <div className="card-head"><h2>Employer verification</h2><Clause>§8.1 OPS-EMP-01</Clause></div>
        <div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr><th>ID</th><th>Employer</th><th className="num">Jobs</th><th>Status</th><th className="right">Action</th></tr></thead>
            <tbody>
              {employers.map((e) => (
                <tr key={e.id}>
                  <td className="id">{e.id}</td><td>{e.brand_name}</td>
                  <td className="num">{e.jobs}</td><td><StatusPill status={e.status} /></td>
                  <td className="right"><OpsActions kind="employer" id={e.id} status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Partner verification and QR control</h2><Clause>§8.2 PART-10</Clause></div>
        <div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr><th>ID</th><th>Partner</th><th>Type</th><th>Code</th><th>PAN</th><th>Status</th><th className="right">Action</th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className="id">{p.id}</td><td>{p.name}</td>
                  <td className="small">{p.partner_type.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="id">{p.code ?? '—'}</td>
                  <td className="small">{p.pan ? <span className="tag good">on file</span> : <span className="tag gap">none</span>}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td className="right"><OpsActions kind="partner" id={p.id} status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Job moderation</h2><Clause>JOB-02 / JOB-03</Clause></div>
        <div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr><th>ID</th><th>Job</th><th>Employer</th><th>Config</th><th className="num">Open</th><th>Expires</th><th>Status</th><th className="right">Action</th></tr></thead>
            <tbody>
              {jobs.map((jb) => (
                <tr key={jb.id}>
                  <td className="id">{jb.id}</td><td>{jb.title}</td><td className="small">{jb.brand}</td>
                  <td className="id">{jb.config}</td><td className="num">{jb.openings}</td>
                  <td className="small muted">{fmtDateTime(jb.expires_at)}</td>
                  <td><StatusPill status={jb.status} /></td>
                  <td className="right"><OpsActions kind="job" id={jb.id} status={jb.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Attribution</h2><Clause>§8.11 REF-01/02</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Candidate</th><th>Partner</th><th>Method</th><th>Status</th><th className="right">Action</th></tr></thead>
              <tbody>
                {attributions.map((a) => (
                  <tr key={a.id}>
                    <td><span className="id">{a.candidate_id}</span><br /><span className="small muted">{a.name}</span></td>
                    <td className="id">{a.partner_id ?? 'direct'}</td>
                    <td className="small">{a.method}</td>
                    <td>
                      <StatusPill status={a.status} />
                      {a.status_reason && <div className="small muted" style={{ marginTop: 3 }}>{a.status_reason}</div>}
                    </td>
                    <td className="right">
                      {a.status === 'UNDER_REVIEW' && <OpsActions kind="attribution" id={a.id} status={a.status} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Invalid-lead replacement cases</h2><Clause>LEAD-08/09</Clause></div>
          <div className="card-body tight">
            {replacements.length === 0 ? <div className="empty">No replacement claims.</div> : (
              <div className="tblwrap">
                <table>
                  <thead><tr><th>Case</th><th>Unlock</th><th>Reason</th><th>Decision</th><th className="right">Action</th></tr></thead>
                  <tbody>
                    {replacements.map((r) => (
                      <tr key={r.id}>
                        <td className="id">{r.id}</td>
                        <td className="id">{r.unlock_id}<br /><span className="small muted">{r.candidate_id}</span></td>
                        <td className="small">{r.reason_code.replace(/_/g, ' ').toLowerCase()}
                          <div className="small muted">{r.evidence.slice(0, 70)}</div>
                        </td>
                        <td><StatusPill status={r.decision} /></td>
                        <td className="right">
                          {r.decision === 'PENDING' && <OpsActions kind="replacement" id={r.id} status={r.decision} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Fraud signals</h2><Clause>REF-07 / END-06</Clause></div>
          <div className="card-body tight">
            {fraud.length === 0 ? <div className="empty">No open cases.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Case</th><th>Subject</th><th>Signal</th><th>Status</th></tr></thead>
                <tbody>
                  {fraud.map((f) => (
                    <tr key={f.id}>
                      <td className="id">{f.id}</td>
                      <td className="small">{f.subject_type} <span className="id">{f.subject_id}</span></td>
                      <td className="small">{f.signal.replace(/_/g, ' ').toLowerCase()}</td>
                      <td><StatusPill status={f.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Audit explorer</h2><Clause>§14 Audit</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Entity</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="small muted">{fmtDateTime(a.created_at)}</td>
                    <td className="small">{a.actor}<br /><span className="muted">{a.actor_role}</span></td>
                    <td className="small">{a.event.replace(/_/g, ' ').toLowerCase()}
                      {a.reason && <div className="muted">{a.reason}</div>}</td>
                    <td className="id">{a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
    </main>
  );
}
