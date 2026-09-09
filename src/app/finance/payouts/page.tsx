import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money, StatusPill } from '../../ui';
import { SubNav, FINANCE_TABS } from '../../subnav';
import { PayoutRow, FinanceActions } from '../finance-client';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const viewer=await scopePage('finance');
  const policy = await activeCommercialPolicy();
  const payouts = await sql<{
    id: string; partner_id: string; name: string; gross_paise: string; tds_paise: string;
    tds_rate_bp: number; net_paise: string; batch_key: string; status: string;
    provider_ref: string | null; approved_by: string | null; created_at: Date; paid_at: Date | null;
  }[]>`
    SELECT p.*, pt.name FROM app.payout p JOIN app.partner pt ON pt.id=p.partner_id
     ORDER BY p.created_at DESC, p.id DESC`;

  return (
    <>
      <SubNav tabs={FINANCE_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Payout batches</h1><a className="btn" href="/finance/statement">Download statement</a>
          <div className="sub">
            s.194H withholding: 2% above ₹20,000 in a financial year with a PAN, 20% without
            {' '}<Clause>REF-09</Clause>
          </div>
        </div>

        <FinanceActions />

        <div className="card"><div className="card-body tight">
          {payouts.length === 0
            ? <div className="empty">
                No payouts. Build a batch above — partners below the{' '}
                <Money paise={policy.partnerPayoutMinimumPaise} /> minimum carry forward instead.
              </div>
            : <div className="tblwrap"><table>
                <thead><tr>
                  <th>Payout</th><th>Partner</th><th>Batch</th><th className="num">Gross</th>
                  <th className="num">TDS</th><th className="num">Net</th><th>Status</th><th className="right">Action</th>
                </tr></thead>
                <tbody>{payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="id">{p.id}<div className="small muted">{fmtDateTime(p.created_at)}</div></td>
                    <td className="small">{p.name}<div className="id">{p.partner_id}</div></td>
                    <td className="small mono" style={{ fontSize: '.72rem' }}>{p.batch_key}</td>
                    <td className="num"><Money paise={p.gross_paise} /></td>
                    <td className="num"><Money paise={p.tds_paise} />
                      <div className="small muted">{(p.tds_rate_bp / 100).toFixed(0)}%</div></td>
                    <td className="num"><strong><Money paise={p.net_paise} /></strong></td>
                    <td><StatusPill status={p.status} />
                      {p.provider_ref && <div className="small muted mono">{p.provider_ref}</div>}
                      {p.approved_by && <div className="small muted">by {p.approved_by}</div>}</td>
                    <td className="right"><PayoutRow id={p.id} status={p.status} /></td>
                  </tr>
                ))}</tbody>
              </table></div>}
        </div></div>
      </main>
    </>
  );
}
