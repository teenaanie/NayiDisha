import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { formatPay } from '@/lib/money';
import { Clause, Money } from '../../ui';
import { SubNav, PARTNER_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function PartnerAlertsPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const viewer=await scopePage('partner');
  const { p } = await searchParams;
  const partnerId = viewer.role==='ADMIN' ? (p ?? 'PAR-001') : viewer.id;

  const alerts = await sql<{
    id: string; job_id: string; title: string; brand: string; loc: string;
    fixed_pay_paise: string; variable_max_paise: string; shift: string;
    bounty_paise: string; sent_at: Date; status: string;
  }[]>`
    SELECT a.id, a.job_id, j.title, e.brand_name AS brand, l.name AS loc,
           j.fixed_pay_paise, j.variable_max_paise, j.shift, a.bounty_paise, a.sent_at, j.status
      FROM app.partner_job_alert a
      JOIN app.job j ON j.id = a.job_id
      JOIN app.employer_organisation e ON e.id = j.employer_id
      JOIN app.employer_location l ON l.id = j.location_id
     WHERE a.partner_id = ${partnerId}
     ORDER BY a.sent_at DESC`;

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Job alerts</h1>
          <div className="sub">
            Role, location, pay and the bounty — and never any candidate data. The bounty is shown
            before you source anyone. <Clause>ALT-03 · REF-04</Clause>
          </div>
        </div>
        <div className="card"><div className="card-body tight">
          {alerts.length === 0
            ? <div className="empty">No alerts yet. A job alerts you when it is approved and matches your specialisation.</div>
            : <div className="tblwrap">
                <table>
                  <thead><tr><th>Job</th><th>Employer</th><th>Location</th><th>Pay</th><th className="num">Bounty</th><th>Sent</th><th>Job status</th></tr></thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id}>
                        <td className="id">{a.job_id}<div className="small">{a.title}</div></td>
                        <td className="small">{a.brand}</td>
                        <td className="small">{a.loc}<div className="muted mono">{a.shift}</div></td>
                        <td className="small">{formatPay(Number(a.fixed_pay_paise), Number(a.variable_max_paise))}</td>
                        <td className="num"><strong><Money paise={a.bounty_paise} /></strong></td>
                        <td className="small muted">{fmtDateTime(a.sent_at)}</td>
                        <td className="small">{a.status.toLowerCase()}</td>
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
