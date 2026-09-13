import {WorkspaceIntro,WorkspaceNextSteps} from '../workspace-components';
import {Icon} from '../ops/dashboard-icon';
import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money } from '../ui';
import { SubNav, FINANCE_TABS } from '../subnav';

export const dynamic = 'force-dynamic';

export default async function FinanceDashboard() {
  const viewer=await scopePage('finance');
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
        <WorkspaceIntro eyebrow="Your finance overview" title="Every reward, accounted for." description="Track balances, review eligible rewards, and manage simulated partner payouts."/>
        <div className="tilegrid">
          {tiles.map((t,i) => (
            <Link key={t.k} href={t.href} className={`tile ${t.attn ? 'attn' : ''}`}>
              <span className="nd-tile-icon"><Icon name={["chart", "clock", "lock", "file", "shield", "chart"][i]}/></span><div className="k">{t.k}</div>
              <div className="v">{t.v}</div>
              <div className="d">{t.d}</div>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>
        <WorkspaceNextSteps items={[{href:'/finance/balances',label:'Review balances',icon:'users',tone:'blue'},{href:'/finance/payouts',label:'Manage payouts',icon:'file',tone:'green'},{href:'/finance/ledger',label:'Explore the ledger',icon:'chart',tone:'purple'}]} title="Clarity at every step." description="Follow each reward from its hold period through eligibility and payout. The ledger keeps a complete record of every movement." href="/finance/ledger" label="View reward history"/>
      </main>
    </>
  );
}
