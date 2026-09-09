import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause, Stat } from '../../ui';
import { SubNav, EMPLOYER_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function OutcomesPage() {
  const viewer=await scopePage('employer');
  const employerId = viewer.role==='ADMIN' ? 'EMP-001' : viewer.id;

  const rows = await sql<{
    id: string; application_id: string; candidate_id: string; name: string; job_id: string;
    title: string; outcome: string; actor: string; source: string; created_at: Date;
  }[]>`
    SELECT o.id, o.application_id, a.candidate_id, CASE WHEN EXISTS(SELECT 1 FROM app.consent_record cr WHERE cr.candidate_id=c.id AND cr.purpose='PROCESSING' AND cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL) THEN c.name ELSE 'Access withdrawn' END AS name, a.job_id, j.title,
           o.outcome, o.actor, o.source, o.created_at
      FROM app.optional_outcome_event o
      JOIN app.application a ON a.id = o.application_id
      JOIN app.candidate c ON c.id = a.candidate_id
      JOIN app.job j ON j.id = a.job_id
     WHERE j.employer_id = ${employerId}
     ORDER BY o.created_at DESC`;

  const funnel = await sql<{ stage: string; n: string }[]>`
    SELECT 'Unlocked' AS stage, COUNT(*)::text n FROM app.qualified_lead_unlock
      WHERE employer_id=${employerId} AND status='CONFIRMED'
    UNION ALL SELECT 'Contacted', COUNT(*)::text FROM app.optional_outcome_event o
      JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
      WHERE j.employer_id=${employerId} AND o.outcome='CONTACTED'
    UNION ALL SELECT 'Interview scheduled', COUNT(*)::text FROM app.optional_outcome_event o
      JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
      WHERE j.employer_id=${employerId} AND o.outcome='INTERVIEW_SCHEDULED'
    UNION ALL SELECT 'Interview attended', COUNT(*)::text FROM app.optional_outcome_event o
      JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
      WHERE j.employer_id=${employerId} AND o.outcome='INTERVIEW_ATTENDED'
    UNION ALL SELECT 'Selected', COUNT(*)::text FROM app.optional_outcome_event o
      JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
      WHERE j.employer_id=${employerId} AND o.outcome='SELECTED'
    UNION ALL SELECT 'Joined', COUNT(*)::text FROM app.optional_outcome_event o
      JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
      WHERE j.employer_id=${employerId} AND o.outcome='JOINED'`;

  const unlocked = Number(funnel.find((f) => f.stage === 'Unlocked')?.n ?? 0);
  const joined = Number(funnel.find((f) => f.stage === 'Joined')?.n ?? 0);

  return (
    <>
      <SubNav tabs={EMPLOYER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Outcomes</h1>
          <div className="sub">
            Optional throughout. Recorded because it is useful to you and to the matching engine —
            never because a charge depends on it <Clause>LEAD-10 · §6.7</Clause>
          </div>
        </div>

        <div className="grid g3 mb">
          <Stat k="Unlocks" v={unlocked} d="profiles opened and paid for" />
          <Stat k="Joined" v={joined} d="where you told us" />
          <Stat k="Unlock-to-join ratio" v={joined > 0 ? `${(unlocked / joined).toFixed(1)}:1` : '—'}
                d="the number that decides whether the price is honest" />
        </div>

        <div className="card">
          <div className="card-head"><h2>Funnel</h2><Clause>§16.2</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Stage</th><th className="num">Count</th></tr></thead>
              <tbody>{funnel.map((f) => (
                <tr key={f.stage}><td>{f.stage}</td><td className="num">{f.n}</td></tr>
              ))}</tbody>
            </table>
          </div></div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Event log</h2></div>
          <div className="card-body tight">
            {rows.length === 0
              ? <div className="empty">Nothing recorded yet. Billing and partner rewards close without it.</div>
              : <div className="tblwrap"><table>
                  <thead><tr><th>When</th><th>Candidate</th><th>Job</th><th>Outcome</th><th>Source</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="small muted">{fmtDateTime(r.created_at)}</td>
                        <td>{r.name}<div className="id">{r.candidate_id}</div></td>
                        <td className="small">{r.title}</td>
                        <td><StatusPill status={r.outcome} /></td>
                        <td className="small muted">{r.source.replace(/_/g, ' ').toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>}
          </div>
        </div>
      </main>
    </>
  );
}
