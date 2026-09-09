import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function FraudPage() {
  const cases = await sql<{
    id: string; subject_type: string; subject_id: string; signal: string;
    detail: Record<string, unknown>; status: string; resolution: string | null; created_at: Date;
  }[]>`SELECT * FROM app.fraud_case ORDER BY (status='OPEN') DESC, created_at DESC`;

  const flagged = await sql<{
    id: string; candidate_id: string; endorser_name: string; relationship: string; status: string;
  }[]>`SELECT id, candidate_id, endorser_name, relationship, status FROM app.endorsement
        WHERE status = 'FLAGGED'`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Fraud signals</h1>
          <div className="sub">
            Self-referral, duplicate accounts, recycled numbers, partner–employer collusion,
            fabricated endorsements and artificial unlock activity <Clause>REF-07 / END-06</Clause>
          </div>
        </div>

        <div className="card"><div className="card-body tight">
          {cases.length === 0 ? <div className="empty">No cases open.</div> : (
            <div className="tblwrap">
              <table>
                <thead><tr><th>Case</th><th>Subject</th><th>Signal</th><th>Detail</th><th>Status</th><th>Raised</th></tr></thead>
                <tbody>
                  {cases.map((f) => (
                    <tr key={f.id}>
                      <td className="id">{f.id}</td>
                      <td className="small">{f.subject_type}<div className="id">{f.subject_id}</div></td>
                      <td className="small">{f.signal.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="small mono" style={{ fontSize: '.72rem' }}>
                        {JSON.stringify(f.detail)}
                      </td>
                      <td><StatusPill status={f.status} />
                        {f.resolution && <div className="small muted">{f.resolution}</div>}</td>
                      <td className="small muted">{fmtDateTime(f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div></div>

        <div className="card">
          <div className="card-head"><h2>Flagged endorsements</h2><Clause>END-06</Clause></div>
          <div className="card-body tight">
            {flagged.length === 0 ? <div className="empty">None flagged.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Endorsement</th><th>Candidate</th><th>Endorser</th><th>Relationship</th></tr></thead>
                <tbody>
                  {flagged.map((e) => (
                    <tr key={e.id}>
                      <td className="id">{e.id}</td>
                      <td className="id">{e.candidate_id}</td>
                      <td className="small">{e.endorser_name}</td>
                      <td className="small">{e.relationship.replace(/_/g, ' ').toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <div className="note small" style={{ margin: 14 }}>
              A flagged endorsement scores zero while flagged, and cannot affect eligibility in any case.
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
