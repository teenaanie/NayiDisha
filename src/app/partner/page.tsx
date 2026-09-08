import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { maskName } from '@/modules/matching';
import { StatusPill, Clause, Money, Stat, QrBlock } from '../ui';
import { PartnerPicker } from './partner-client';

export const dynamic = 'force-dynamic';

export default async function PartnerPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const partnerId = p ?? 'PAR-001';
  const policy = await activeCommercialPolicy();

  const all = await sql<{ id: string; name: string; status: string }[]>`
    SELECT id, name, status FROM app.partner ORDER BY id`;

  const [partner] = await sql<{
    id: string; name: string; partner_type: string; status: string; pan: string | null;
    payout_upi: string | null; capabilities: string[]; service_localities: string[];
  }[]>`SELECT * FROM app.partner WHERE id=${partnerId}`;

  const sites = await sql<{
    id: string; partner_code: string; qr_token: string; locality_key: string; status: string;
  }[]>`SELECT * FROM app.partner_site WHERE partner_id=${partnerId} ORDER BY id`;

  /**
   * PART-08/09 — the partner sees only attributed candidates who consented to
   * assistance, and never their contact details or documents.
   */
  const funnel = await sql<{
    candidate_id: string; name: string | null; status: string; locality_key: string | null;
    assisted: boolean; applications: string; qualified: string; unlocked: string; bound_at: Date;
    attr_status: string;
  }[]>`
    SELECT c.id AS candidate_id, c.name, c.status, c.locality_key, a.bound_at, a.status AS attr_status,
           COALESCE((SELECT cr.granted_at IS NOT NULL AND cr.withdrawn_at IS NULL
                       FROM app.consent_record cr
                      WHERE cr.candidate_id=c.id AND cr.purpose='PARTNER_ASSISTANCE'), FALSE) AS assisted,
           (SELECT COUNT(*)::text FROM app.application ap WHERE ap.candidate_id=c.id) AS applications,
           (SELECT COUNT(*)::text FROM app.match_result m WHERE m.candidate_id=c.id AND m.qualified) AS qualified,
           (SELECT COUNT(*)::text FROM app.qualified_lead_unlock u
             WHERE u.candidate_id=c.id AND u.status='CONFIRMED') AS unlocked
      FROM app.attribution a JOIN app.candidate c ON c.id=a.candidate_id
     WHERE a.partner_id=${partnerId}
     ORDER BY a.bound_at`;

  const [summary] = await partnerRewardSummary(partnerId);

  const ledger = await sql<{
    id: string; entry_type: string; amount_paise: string; status: string;
    hold_until: Date | null; unlock_id: string | null; note: string | null; created_at: Date;
  }[]>`
    SELECT * FROM app.reward_ledger WHERE partner_id=${partnerId} ORDER BY created_at, id`;

  const alerts = await sql<{
    id: string; title: string; brand: string; loc: string; fixed_pay_paise: string;
  }[]>`
    SELECT j.id, j.title, e.brand_name AS brand, l.name AS loc, j.fixed_pay_paise
      FROM app.job j
      JOIN app.employer_organisation e ON e.id=j.employer_id
      JOIN app.employer_location l ON l.id=j.location_id
     WHERE j.status='LIVE' ORDER BY j.id`;

  const eligible = summary?.eligiblePaise ?? 0;
  const shortfall = Math.max(policy.partnerPayoutMinimumPaise - eligible, 0);

  return (
    <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>{partner.name}</h1>
            <div className="sub">
              {partner.partner_type.replace(/_/g, ' ').toLowerCase()} · {partner.service_localities.join(', ').replace(/_/g, ' ')}
              {' · '}<StatusPill status={partner.status} /> <Clause>§10.4</Clause>
            </div>
          </div>
          <PartnerPicker partners={all} current={partnerId} />
        </div>
      </div>

      <div className="grid g3 mb">
        <Stat k="Attributed candidates" v={funnel.length} d={`${funnel.filter((f) => f.assisted).length} consented to assistance`} />
        <Stat k="Rewards in hold" v={<Money paise={summary?.inHoldPaise ?? 0} />} d={`${policy.partnerRewardHoldHours}h fraud hold`} />
        <Stat k="Eligible for payout" v={<Money paise={eligible} />}
              d={shortfall > 0
                ? <span style={{ color: 'var(--warn)' }}>needs {<></>}{`₹${shortfall / 100} more to reach the ₹${policy.partnerPayoutMinimumPaise / 100} minimum`}</span>
                : 'clears the payout minimum'} />
      </div>

      {shortfall > 0 && eligible > 0 && (
        <div className="note warn mb">
          <strong>Carry forward.</strong> This partner has {<Money paise={eligible} />} eligible but the
          payout minimum is {<Money paise={policy.partnerPayoutMinimumPaise} />}. At{' '}
          {<Money paise={policy.partnerRewardPaise} />} per valid unlock, that is{' '}
          {Math.ceil(policy.partnerPayoutMinimumPaise / policy.partnerRewardPaise)} unlocks before any money moves.
          <Clause>REF-10</Clause>
        </div>
      )}

      <div className="split">
        <div>
          <div className="card">
            <div className="card-head"><h2>Attributed candidate funnel</h2><Clause>PART-08/09</Clause></div>
            <div className="card-body tight">
              {funnel.length === 0 ? <div className="empty">No attributed candidates yet.</div> : (
                <div className="tblwrap">
                  <table>
                    <thead><tr><th>Candidate</th><th>Locality</th><th>Assist</th><th className="num">Apps</th><th className="num">Qual</th><th className="num">Unlocked</th><th>Attribution</th></tr></thead>
                    <tbody>
                      {funnel.map((f) => (
                        <tr key={f.candidate_id}>
                          <td><strong>{maskName(f.name)}</strong>
                            <div className="small muted">contact masked from partners</div></td>
                          <td className="small">{f.locality_key?.replace(/_/g, ' ') ?? '—'}</td>
                          <td>{f.assisted ? <span className="pill p-ok">consented</span> : <span className="pill p-mute">no</span>}</td>
                          <td className="num">{f.applications}</td>
                          <td className="num">{f.qualified}</td>
                          <td className="num">{f.unlocked}</td>
                          <td><StatusPill status={f.attr_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Reward ledger</h2><Clause>REF-08 append-only</Clause></div>
            <div className="card-body tight">
              {ledger.length === 0 ? <div className="empty">No reward entries.</div> : (
                <div className="tblwrap">
                  <table>
                    <thead><tr><th>Entry</th><th>Type</th><th>Unlock</th><th className="num">Amount</th><th>Status</th><th>Hold until</th></tr></thead>
                    <tbody>
                      {ledger.map((l) => (
                        <tr key={l.id}>
                          <td className="id">{l.id}</td>
                          <td className="small">{l.entry_type.toLowerCase()}
                            {l.note && <div className="muted">{l.note}</div>}</td>
                          <td className="id">{l.unlock_id ?? '—'}</td>
                          <td className="num" style={{ color: Number(l.amount_paise) < 0 ? 'var(--bad)' : undefined }}>
                            <Money paise={l.amount_paise} />
                          </td>
                          <td><StatusPill status={l.status} /></td>
                          <td className="small muted">{fmtDateTime(l.hold_until)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="note small" style={{ margin: 14 }}>
                Reversals are new linked rows, never edits. A reward is created by a valid attributed
                unlock and does not wait for interview, joining or retention. <Clause>REF-05</Clause>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Open job alerts</h2><Clause>ALT-03</Clause></div>
            <div className="card-body tight">
              <div className="tblwrap">
                <table>
                  <thead><tr><th>Job</th><th>Employer</th><th>Location</th><th className="num">Fixed pay</th><th className="num">Bounty</th></tr></thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id}>
                        <td className="id">{a.id}<br />{a.title}</td>
                        <td className="small">{a.brand}</td>
                        <td className="small">{a.loc}</td>
                        <td className="num"><Money paise={a.fixed_pay_paise} /></td>
                        <td className="num"><Money paise={policy.partnerRewardPaise} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="note small" style={{ margin: 14 }}>
                Alerts carry role, location, pay and bounty terms — never candidate data.
              </div>
            </div>
          </div>
        </div>

        <div>
          {sites.map((s) => (
            <div className="card" key={s.id}>
              <div className="card-head">
                <h3>{s.locality_key.replace(/_/g, ' ')} site</h3>
                <StatusPill status={s.status} />
              </div>
              <div className="card-body">
                <div className="qr-card">
                  <div style={{ fontSize: '.66rem', letterSpacing: '.16em', textTransform: 'uppercase', opacity: .85 }}>
                    नोकरी · JOBS
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.15, margin: '7px 0 10px' }}>
                    पास में बैंक की नौकरी?
                  </div>
                  <QrBlock seed={s.qr_token} />
                  <div className="code">{s.partner_code}</div>
                  <div className="free">
                    यह सेवा नौकरी ढूँढने वालों के लिए मुफ़्त है<br />
                    Free for job seekers · PART-06
                  </div>
                </div>
                <div className="small muted mt">
                  Scan target: <code>/j/{s.qr_token}</code><br />
                  Typed code also works, for a cracked screen or no data balance.
                </div>
                <div className="btnrow mt">
                  <a className="btn btn-sm btn-primary" href={`/j/${s.qr_token}`}>Open the candidate journey</a>
                </div>
              </div>
            </div>
          ))}

          <div className="card">
            <div className="card-head"><h3>Payout details</h3><Clause>PART-04 · s.194H</Clause></div>
            <div className="card-body">
              <table>
                <tbody className="small">
                  <tr><td>UPI</td><td className="right mono">{partner.payout_upi ?? '—'}</td></tr>
                  <tr><td>PAN on file</td><td className="right">
                    {partner.pan ? <span className="pill p-ok">yes</span> : <span className="pill p-warn">no — 20% TDS above ₹20,000</span>}
                  </td></tr>
                  <tr><td>Paid this FY</td><td className="right"><Money paise={summary?.paidPaise ?? 0} /></td></tr>
                  <tr><td>Reversed</td><td className="right"><Money paise={summary?.reversedPaise ?? 0} /></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
