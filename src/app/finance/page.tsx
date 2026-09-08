import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { StatusPill, Clause, Money, Stat } from '../ui';
import { FinanceActions, PayoutRow } from './finance-client';

export const dynamic = 'force-dynamic';

export default async function FinancePage() {
  const policy = await activeCommercialPolicy();
  const summaries = await partnerRewardSummary();

  const payouts = await sql<{
    id: string; partner_id: string; name: string; gross_paise: string; tds_paise: string;
    tds_rate_bp: number; net_paise: string; batch_key: string; status: string;
    provider_ref: string | null; created_at: Date; paid_at: Date | null;
  }[]>`
    SELECT p.*, pt.name FROM app.payout p JOIN app.partner pt ON pt.id=p.partner_id
     ORDER BY p.created_at DESC, p.id DESC`;

  const revenue = await sql<{
    entitlements: string; posting_paise: string; purchased_paise: string; unlocks: string;
  }[]>`
    SELECT COUNT(DISTINCT e.id)::text AS entitlements,
           COALESCE(SUM(e.posting_fee_paise),0)::text AS posting_paise,
           (SELECT COALESCE(SUM(amount_paise),0) FROM app.credit_ledger WHERE entry_type='PURCHASE')::text AS purchased_paise,
           (SELECT COUNT(*) FROM app.qualified_lead_unlock WHERE status='CONFIRMED')::text AS unlocks
      FROM app.posting_entitlement e`;

  const rev = revenue[0];
  const grossRevenue = Number(rev.posting_paise) + Number(rev.purchased_paise);
  const rewardCost = summaries.reduce((a, s) => a + s.inHoldPaise + s.eligiblePaise + s.paidPaise, 0);

  const ledgerAll = await sql<{
    id: string; partner_id: string; entry_type: string; amount_paise: string;
    status: string; unlock_id: string | null; linked_entry_id: string | null; created_at: Date;
  }[]>`SELECT * FROM app.reward_ledger ORDER BY created_at, id`;

  const ledgerSum = ledgerAll.reduce((a, l) => a + Number(l.amount_paise), 0);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Finance</h1>
        <div className="sub">
          Reward ledger, withholding and simulated payouts · signed in as DEMO Finance Operator
          {' '}<Clause>§5 · REF-09/10</Clause>
        </div>
      </div>

      <div className="grid g3 mb">
        <Stat k="Gross commercial revenue" v={<Money paise={grossRevenue} />}
              d={`${rev.entitlements} posting entitlements · ${rev.unlocks} unlocks`} />
        <Stat k="Partner reward cost" v={<Money paise={rewardCost} />}
              d={`${Math.round((rewardCost / Math.max(grossRevenue, 1)) * 100)}% of gross revenue`} />
        <Stat k="Ledger net position" v={<Money paise={ledgerSum} />}
              d="accruals less reversals and payouts" />
      </div>

      <FinanceActions />

      <div className="card">
        <div className="card-head">
          <h2>Partner balances</h2>
          <span className="small muted">
            payout minimum <Money paise={policy.partnerPayoutMinimumPaise} /> · {policy.payoutCadence.replace('_', ' ').toLowerCase()}
          </span>
        </div>
        <div className="card-body tight">
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Partner</th><th>PAN</th><th className="num">In hold</th><th className="num">Eligible</th>
                  <th className="num">Paid</th><th className="num">Reversed</th><th>Payable?</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => {
                  const payable = s.eligiblePaise >= policy.partnerPayoutMinimumPaise && !!s.upi;
                  const short = policy.partnerPayoutMinimumPaise - s.eligiblePaise;
                  return (
                    <tr key={s.partnerId}>
                      <td><span className="id">{s.partnerId}</span><br />{s.partnerName}</td>
                      <td>{s.hasPan ? <span className="pill p-ok">yes</span> : <span className="pill p-warn">no</span>}</td>
                      <td className="num"><Money paise={s.inHoldPaise} /></td>
                      <td className="num"><Money paise={s.eligiblePaise} /></td>
                      <td className="num"><Money paise={s.paidPaise} /></td>
                      <td className="num" style={{ color: s.reversedPaise ? 'var(--bad)' : undefined }}>
                        <Money paise={s.reversedPaise} />
                      </td>
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
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Payout batches</h2><Clause>REF-09</Clause></div>
        <div className="card-body tight">
          {payouts.length === 0
            ? <div className="empty">
                No payouts yet. Build a batch above — partners below the{' '}
                <Money paise={policy.partnerPayoutMinimumPaise} /> minimum carry forward rather than being paid.
              </div>
            : <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th>Payout</th><th>Partner</th><th>Batch</th><th className="num">Gross</th>
                      <th className="num">TDS</th><th className="num">Net</th><th>Status</th><th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id}>
                        <td className="id">{p.id}<div className="muted small">{fmtDateTime(p.created_at)}</div></td>
                        <td className="small">{p.name}</td>
                        <td className="small mono" style={{ fontSize: '.72rem' }}>{p.batch_key}</td>
                        <td className="num"><Money paise={p.gross_paise} /></td>
                        <td className="num">
                          <Money paise={p.tds_paise} />
                          <div className="muted small">{(p.tds_rate_bp / 100).toFixed(0)}%</div>
                        </td>
                        <td className="num"><strong><Money paise={p.net_paise} /></strong></td>
                        <td><StatusPill status={p.status} />
                          {p.provider_ref && <div className="small muted mono">{p.provider_ref}</div>}</td>
                        <td className="right"><PayoutRow id={p.id} status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Full reward ledger</h2>
          <span className="small muted">append-only · corrections are linked rows</span>
        </div>
        <div className="card-body tight">
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Entry</th><th>Partner</th><th>Type</th><th>Unlock</th><th>Links</th><th className="num">Amount</th><th>Status</th><th>When</th></tr>
              </thead>
              <tbody>
                {ledgerAll.map((l) => (
                  <tr key={l.id}>
                    <td className="id">{l.id}</td>
                    <td className="id">{l.partner_id}</td>
                    <td className="small">{l.entry_type.toLowerCase()}</td>
                    <td className="id">{l.unlock_id ?? '—'}</td>
                    <td className="id">{l.linked_entry_id ?? '—'}</td>
                    <td className="num" style={{ color: Number(l.amount_paise) < 0 ? 'var(--bad)' : undefined }}>
                      <Money paise={l.amount_paise} />
                    </td>
                    <td><StatusPill status={l.status} /></td>
                    <td className="small muted">{fmtDateTime(l.created_at)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5}><strong>Net</strong></td>
                  <td className="num"><strong><Money paise={ledgerSum} /></strong></td>
                  <td colSpan={2} className="small muted">reconciles to the payout provider</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
