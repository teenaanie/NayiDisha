import Link from 'next/link';
import { sql } from '@/lib/db';
import { Stat, Clause, StatusPill, Money } from './ui';
import { DemoControls } from './demo-controls';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [counts] = await sql<{
    employers: string; partners: string; sites: string; jobs: string; candidates: string;
    qualified: string; unlocks: string; rewards: string;
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM app.employer_organisation WHERE status='VERIFIED')::text AS employers,
      (SELECT COUNT(*) FROM app.partner WHERE status='VERIFIED')::text AS partners,
      (SELECT COUNT(*) FROM app.partner_site WHERE status='ACTIVE')::text AS sites,
      (SELECT COUNT(*) FROM app.job WHERE status='LIVE')::text AS jobs,
      (SELECT COUNT(*) FROM app.candidate WHERE status='PROFILE_ACTIVE')::text AS candidates,
      (SELECT COUNT(*) FROM app.match_result WHERE qualified)::text AS qualified,
      (SELECT COUNT(*) FROM app.qualified_lead_unlock WHERE status='CONFIRMED')::text AS unlocks,
      (SELECT COALESCE(SUM(amount_paise),0) FROM app.reward_ledger WHERE entry_type='ACCRUAL' AND status<>'REVERSED')::text AS rewards
  `;

  const funnel = await sql<{ stage: string; n: string }[]>`
    SELECT 'Mobile verified' AS stage, COUNT(*)::text AS n FROM app.candidate WHERE mobile_verified_at IS NOT NULL
    UNION ALL SELECT 'Profile complete', COUNT(*)::text FROM app.candidate WHERE status='PROFILE_ACTIVE'
    UNION ALL SELECT 'Applied', COUNT(*)::text FROM app.application
    UNION ALL SELECT 'Reconfirmed', COUNT(*)::text FROM app.application WHERE reconfirmed_at IS NOT NULL
    UNION ALL SELECT 'Qualified', COUNT(*)::text FROM app.match_result WHERE qualified
    UNION ALL SELECT 'Unlocked', COUNT(*)::text FROM app.qualified_lead_unlock WHERE status='CONFIRMED'
    UNION ALL SELECT 'Replacement approved', COUNT(*)::text FROM app.replacement_case WHERE decision='APPROVED'
  `;

  const configs = await sql<{ id: string; industry_key: string; role_family_key: string; version: string; status: string }[]>`
    SELECT id, industry_key, role_family_key, version, status FROM app.role_configuration ORDER BY id
  `;

  const steps = [
    ['Operations publishes the Pune BFSI configuration and approves an employer and partner', '/ops'],
    ['Employer posts a Relationship Executive job for a configured location', '/employer'],
    ['Partner displays its QR and code; a candidate enters the WhatsApp journey', '/partner'],
    ['Candidate verifies a demo OTP, completes profile, consents, takes the assessment and applies', '/wa'],
    ['A senior submits a verified-contact endorsement', '/wa'],
    ['Matching shows eligibility, score components, gaps and commute estimate', '/employer'],
    ['Employer sees a masked preview and deliberately unlocks it using demo credit', '/employer'],
    ['Unlock reveals consented fields, writes an immutable event, makes a partner reward eligible', '/partner'],
    ['Finance approves a simulated payout; ledger and dashboards reconcile', '/finance'],
    ['Employer optionally records outcomes; these do not affect charge or reward', '/employer'],
  ];

  return (
    <main className="page">
      <div className="page-head">
        <h1>Multi-Industry Frontline Hiring Platform</h1>
        <div className="sub">
          Working prototype of PRD v1.3 · Pune BFSI launch configuration · WhatsApp-first candidate experience
        </div>
      </div>

      <div className="grid g3 mb">
        <Stat k="Verified employers" v={counts.employers} d={`${counts.jobs} live vacancies`} />
        <Stat k="Verified partners" v={counts.partners} d={`${counts.sites} active QR sites`} />
        <Stat k="Active candidates" v={counts.candidates} d={`${counts.qualified} job-specific qualified profiles`} />
        <Stat k="Confirmed unlocks" v={counts.unlocks} d="charged once per employer/job/candidate" />
        <Stat k="Partner rewards accrued" v={<Money paise={counts.rewards} />} d="funded from posting/unlock revenue" />
        <Stat k="Travel-time provider" v={<span style={{ fontSize: '1rem' }}>seeded matrix</span>} d="zero cost, deterministic" />
      </div>

      <div className="split">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Prototype success path</h2>
              <Clause>§21.1</Clause>
            </div>
            <div className="card-body tight">
              <div className="tblwrap">
                <table>
                  <tbody>
                    {steps.map(([label, href], i) => (
                      <tr key={i}>
                        <td className="id" style={{ width: 34 }}>{String(i + 1).padStart(2, '0')}</td>
                        <td>{label}</td>
                        <td style={{ width: 90 }} className="right">
                          <Link className="btn btn-sm" href={href}>Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Funnel</h2><Clause>§16.2</Clause>
            </div>
            <div className="card-body tight">
              <div className="tblwrap">
                <table>
                  <thead><tr><th>Stage</th><th className="num">Count</th></tr></thead>
                  <tbody>
                    {funnel.map((f) => (
                      <tr key={f.stage}><td>{f.stage}</td><td className="num">{f.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div>
          <DemoControls />

          <div className="card">
            <div className="card-head"><h3>Industry configurations</h3><Clause>§8.4A</Clause></div>
            <div className="card-body tight">
              <div className="tblwrap">
                <table>
                  <tbody>
                    {configs.map((c) => (
                      <tr key={c.id}>
                        <td className="id">{c.id}</td>
                        <td className="small">{c.industry_key} · v{c.version}</td>
                        <td className="right"><StatusPill status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>What is simulated</h3><Clause>§21.3</Clause></div>
            <div className="card-body">
              <p className="small muted" style={{ marginBottom: 8 }}>
                Every external provider is behind an adapter and resolves to a simulator. Nothing here
                reaches a real recipient, and nothing costs money.
              </p>
              <table>
                <tbody className="small">
                  <tr><td>WhatsApp</td><td className="right"><span className="tag">simulator</span></td></tr>
                  <tr><td>OTP / SMS</td><td className="right"><span className="tag">simulator</span></td></tr>
                  <tr><td>Maps / travel time</td><td className="right"><span className="tag">seeded matrix</span></td></tr>
                  <tr><td>Payouts</td><td className="right"><span className="tag">simulator</span></td></tr>
                  <tr><td>Documents / KYC</td><td className="right"><span className="tag">out of scope</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
