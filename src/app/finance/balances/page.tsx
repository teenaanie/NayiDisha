import {sql} from '@/lib/db';
import {scopePage} from '@/lib/auth';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money } from '../../ui';
import { SubNav, FINANCE_TABS } from '../../subnav';
import { FinanceActions } from '../finance-client';

export const dynamic = 'force-dynamic';

export default async function BalancesPage() {
  const viewer=await scopePage('finance');
  const policy = await activeCommercialPolicy();
  const summaries = await partnerRewardSummary();

  const recoveries=await sql`SELECT partner_id,SUM(amount_paise-recovered_paise) AS outstanding FROM app.payout_recovery GROUP BY partner_id`;
  return (
    <>
      <SubNav tabs={FINANCE_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Partner balances</h1><div className="note"><strong>Recovery balances</strong><p>Paid rewards cannot be recalled by changing a status. Approved reversals offset future payouts.</p>{recoveries.map(d=><p key={d.partner_id}>{d.partner_id}: ₹{Number(d.outstanding)/100} outstanding</p>)}</div>
          <div className="sub">
            Payout minimum <Money paise={policy.partnerPayoutMinimumPaise} />,{' '}
            {policy.payoutCadence.replace('_', ' ').toLowerCase()} <Clause>REF-10</Clause>
          </div>
        </div>

        <FinanceActions />

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>Partner</th><th>PAN</th><th>UPI</th><th className="num">In hold</th>
              <th className="num">Reserved / disputed</th><th className="num">Eligible</th><th className="num">Paid</th><th className="num">Reversed</th>
              <th>Payable?</th>
            </tr></thead>
            <tbody>
              {summaries.map((s) => {
                const payable = s.eligiblePaise >= policy.partnerPayoutMinimumPaise && !!s.upi;
                const short = policy.partnerPayoutMinimumPaise - s.eligiblePaise;
                return (
                  <tr key={s.partnerId}>
                    <td><span className="id">{s.partnerId}</span><div>{s.partnerName}</div></td>
                    <td>{s.hasPan ? <span className="pill p-ok">yes</span> : <span className="pill p-warn">no · 20% TDS</span>}</td>
                    <td className="small mono">{s.upi ?? '—'}</td>
                    <td className="num"><Money paise={s.inHoldPaise} /></td>
                    <td className="num"><Money paise={s.approvedPaise}/> / <Money paise={s.disputedPaise}/></td><td className="num"><Money paise={s.eligiblePaise} /></td>
                    <td className="num"><Money paise={s.paidPaise} /></td>
                    <td className="num" style={{ color: s.reversedPaise ? 'var(--bad)' : undefined }}>
                      <Money paise={s.reversedPaise} /></td>
                    <td>
                      {s.eligiblePaise === 0 ? <span className="pill p-mute">nothing due</span>
                        : payable ? <span className="pill p-ok">payable</span>
                        : <span className="pill p-warn">carry forward · ₹{short / 100} short</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div></div>
      </main>
    </>
  );
}
