import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money, StatusPill, Stat } from '../../ui';
import { SubNav, PARTNER_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function PartnerRewardsPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const viewer=await scopePage('partner');
  const { p } = await searchParams;
  const partnerId = viewer.role==='ADMIN' ? (p ?? 'PAR-001') : viewer.id;
  const policy = await activeCommercialPolicy();
  const [s] = await partnerRewardSummary(partnerId);

  const ledger = await sql<{
    id: string; entry_type: string; amount_paise: string; status: string; hold_until: Date | null;
    unlock_id: string | null; linked_entry_id: string | null; payout_id: string | null;
    fy_label: string; note: string | null; created_at: Date;
  }[]>`SELECT * FROM app.reward_ledger WHERE partner_id=${partnerId} ORDER BY created_at, id`;

  const payouts = await sql<{
    id: string; gross_paise: string; tds_paise: string; tds_rate_bp: number; net_paise: string;
    status: string; provider_ref: string | null; batch_key: string; paid_at: Date | null;
  }[]>`SELECT * FROM app.payout WHERE partner_id=${partnerId} ORDER BY created_at DESC`;

  const eligible = s?.eligiblePaise ?? 0;
  const short = Math.max(policy.partnerPayoutMinimumPaise - eligible, 0);
  const unlocksNeeded = Math.ceil(policy.partnerPayoutMinimumPaise / policy.partnerRewardPaise);

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Rewards</h1><a className="btn" href="/finance/statement">Download statement</a>
          <div className="sub">
            Earned on a valid attributed unlock — never on a scan, a registration or an application
            {' '}<Clause>REF-03 / REF-05 / REF-08</Clause>
          </div>
        </div>

        <div className="grid g3 mb">
          <Stat k="In hold" v={<Money paise={s?.inHoldPaise ?? 0} />} d={`${policy.partnerRewardHoldHours}h fraud hold`} />
          <Stat k="Eligible" v={<Money paise={eligible} />} d={short > 0 ? `₹${short / 100} short of the ₹${policy.partnerPayoutMinimumPaise / 100} minimum` : 'payable'} />
          <Stat k="Paid this FY" v={<Money paise={s?.paidPaise ?? 0} />} d={s?.hasPan ? 'TDS 2% with PAN' : 'TDS 20% without PAN'} />
        </div>

        {short > 0 && eligible > 0 && (
          <div className="note warn mb">
            <strong>Carry forward.</strong> At <Money paise={policy.partnerRewardPaise} /> per valid
            unlock, {unlocksNeeded} unlocks are needed before any money moves. Until then the balance
            simply accumulates. <Clause>REF-10</Clause>
          </div>
        )}

        <div className="card">
          <div className="card-head"><h2>Reward ledger</h2><span className="small muted">append-only</span></div>
          <div className="card-body tight">
            {ledger.length === 0 ? <div className="empty">No entries.</div> : (
              <div className="tblwrap"><table>
                <thead><tr><th>Entry</th><th>Type</th><th>Unlock</th><th>Corrects</th><th className="num">Amount</th><th>Status</th><th>Hold until</th><th>FY</th></tr></thead>
                <tbody>{ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="id">{l.id}</td>
                    <td className="small">{l.entry_type.toLowerCase()}
                      {l.note && <div className="muted">{l.note}</div>}</td>
                    <td className="id">{l.unlock_id ?? '—'}</td>
                    <td className="id">{l.linked_entry_id ?? '—'}</td>
                    <td className="num" style={{ color: Number(l.amount_paise) < 0 ? 'var(--bad)' : undefined }}>
                      <Money paise={l.amount_paise} /></td>
                    <td><StatusPill status={l.status} /></td>
                    <td className="small muted">{fmtDateTime(l.hold_until)}</td>
                    <td className="small mono">{l.fy_label}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Payouts</h2><Clause>REF-09 · s.194H</Clause></div>
          <div className="card-body tight">
            {payouts.length === 0
              ? <div className="empty">No payouts yet.</div>
              : <div className="tblwrap"><table>
                  <thead><tr><th>Payout</th><th>Batch</th><th className="num">Gross</th><th className="num">TDS</th><th className="num">Net</th><th>Status</th><th>Paid</th></tr></thead>
                  <tbody>{payouts.map((x) => (
                    <tr key={x.id}>
                      <td className="id">{x.id}<div className="small muted">{x.provider_ref}</div></td>
                      <td className="small mono" style={{ fontSize: '.72rem' }}>{x.batch_key}</td>
                      <td className="num"><Money paise={x.gross_paise} /></td>
                      <td className="num"><Money paise={x.tds_paise} /><div className="small muted">{(x.tds_rate_bp / 100).toFixed(0)}%</div></td>
                      <td className="num"><strong><Money paise={x.net_paise} /></strong></td>
                      <td><StatusPill status={x.status} /></td>
                      <td className="small muted">{fmtDateTime(x.paid_at)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>}
          </div>
        </div>
      </main>
    </>
  );
}
