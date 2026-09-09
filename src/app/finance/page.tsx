import Link from 'next/link';
import { sql } from '@/lib/db';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money } from '../ui';
import { SubNav, FINANCE_TABS } from '../subnav';

export const dynamic = 'force-dynamic';

export default async function FinanceDashboard() {
  const policy = await activeCommercialPolicy();
  const summaries = await partnerRewardSummary();

  const [rev] = await sql<{ posting: string; purchased: string; unlocks: string; payouts: string }[]>`
    SELECT
      (SELECT COALESCE(SUM(posting_fee_paise),0) FROM app.posting_entitlement)::text AS posting,
      (SELECT COALESCE(SUM(amount_paise),0) FROM app.credit_ledger WHERE entry_type='PURCHASE')::text AS purchased,
      (SELECT COUNT(*) FROM app.qualified_lead_unlock WHERE status='CONFIRMED')::text AS unlocks,
      (SELECT COUNT(*) FROM app.payout)::text AS payouts`;

  const gross = Number(rev.posting) + Number(rev.purchased);
  const inHold = summaries.reduce((a, s) => a + s.inHoldPaise, 0);
  const eligible = summaries.reduce((a, s) => a + s.eligiblePaise, 0);
  const paid = summaries.reduce((a, s) => a + s.paidPaise, 0);
  const payable = summaries.filter((s) => s.eligiblePaise >= policy.partnerPayoutMinimumPaise && s.upi).length;
  const carrying = summaries.filter((s) => s.eligiblePaise > 0 && s.eligiblePaise < policy.partnerPayoutMinimumPaise).length;

  const tiles = [
    { k: 'Gross commercial revenue', v: <Money paise={gross} />, d: `${rev.unlocks} unlocks`, href: '/finance/ledger' },
    { k: 'Rewards in hold', v: <Money paise={inHold} />, d: `${policy.partnerRewardHoldHours}h fraud hold`, href: '/finance/balances' },
    { k: 'Eligible for payout', v: <Money paise={eligible} />, d: `${payable} partner(s) clear the minimum`, href: '/finance/balances' },
    { k: 'Carrying forward', v: carrying, d: `below the ₹${policy.partnerPayoutMinimumPaise / 100} minimum`, href: '/finance/balances', attn: carrying > 0 },
    { k: 'Paid to date', v: <Money paise={paid} />, d: `${rev.payouts} payout row(s)`, href: '/finance/payouts' },
    { k: 'Reward cost as % of revenue', v: gross > 0 ? `${Math.round(((inHold + eligible + paid) / gross) * 100)}%` : '—',
      d: 'funded from posting and unlock revenue', href: '/finance/ledger' },
  ];

  return (
    <>
      <SubNav tabs={FINANCE_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Finance</h1>
          <div className="sub">
            DEMO Finance Operator · the internal ledger is the source of truth; a payment provider is
            only an execution channel <Clause>§24.2 · REF-09/10</Clause>
          </div>
        </div>
        <div className="tilegrid">
          {tiles.map((t) => (
            <Link key={t.k} href={t.href} className={`tile ${t.attn ? 'attn' : ''}`}>
              <div className="k">{t.k}</div>
              <div className="v">{t.v}</div>
              <div className="d">{t.d}</div>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
