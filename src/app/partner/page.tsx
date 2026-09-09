import Link from 'next/link';
import { sql } from '@/lib/db';
import { partnerRewardSummary } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money, StatusPill } from '../ui';
import { SubNav, PARTNER_TABS } from '../subnav';
import { PartnerPicker } from './partner-client';

export const dynamic = 'force-dynamic';

export default async function PartnerDashboard({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const partnerId = p ?? 'PAR-001';
  const policy = await activeCommercialPolicy();

  const all = await sql<{ id: string; name: string; status: string }[]>`
    SELECT id, name, status FROM app.partner ORDER BY id`;
  const [partner] = await sql<{
    id: string; name: string; partner_type: string; status: string;
    conduct_accepted_at: Date | null; pan: string | null;
  }[]>`SELECT * FROM app.partner WHERE id=${partnerId}`;

  const [c] = await sql<{
    sites: string; candidates: string; qualified: string; unlocked: string; alerts: string;
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM app.partner_site WHERE partner_id=${partnerId} AND status='ACTIVE')::text AS sites,
      (SELECT COUNT(*) FROM app.attribution WHERE partner_id=${partnerId})::text AS candidates,
      (SELECT COUNT(*) FROM app.attribution a JOIN app.match_result m ON m.candidate_id=a.candidate_id
        WHERE a.partner_id=${partnerId} AND m.qualified)::text AS qualified,
      (SELECT COUNT(*) FROM app.qualified_lead_unlock u
        WHERE u.attributed_partner_id=${partnerId} AND u.status='CONFIRMED')::text AS unlocked,
      (SELECT COUNT(*) FROM app.partner_job_alert WHERE partner_id=${partnerId})::text AS alerts`;

  const [s] = await partnerRewardSummary(partnerId);
  const eligible = s?.eligiblePaise ?? 0;
  const short = Math.max(policy.partnerPayoutMinimumPaise - eligible, 0);

  const tiles = [
    { k: 'Active QR sites', v: c.sites, d: 'printed codes in the field', href: '/partner/sites' },
    { k: 'Candidates attributed', v: c.candidates, d: `${c.qualified} reached qualified`, href: '/partner/candidates' },
    { k: 'Open job alerts', v: c.alerts, d: 'matched to your specialisation', href: '/partner/alerts' },
    { k: 'Rewards in hold', v: <Money paise={s?.inHoldPaise ?? 0} />, d: `${policy.partnerRewardHoldHours}h fraud hold`, href: '/partner/rewards' },
    { k: 'Eligible for payout', v: <Money paise={eligible} />, d: short > 0 ? `₹${short / 100} short of the minimum` : 'clears the minimum', href: '/partner/rewards', attn: short > 0 && eligible > 0 },
    { k: 'Conduct rules', v: partner.conduct_accepted_at ? 'Accepted' : 'Not accepted', d: 'required before rewards are paid', href: '/partner/conduct', attn: !partner.conduct_accepted_at },
  ];

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>{partner.name}</h1>
              <div className="sub">
                {partner.partner_type.replace(/_/g, ' ').toLowerCase()} · <StatusPill status={partner.status} />
                {' '}<Clause>§10.4</Clause>
              </div>
            </div>
            <PartnerPicker partners={all} current={partnerId} />
          </div>
        </div>
        <div className="tilegrid">
          {tiles.map((t) => (
            <Link key={t.k} href={`${t.href}?p=${partnerId}`} className={`tile ${t.attn ? 'attn' : ''}`}>
              <div className="k">{t.k}</div>
              <div className="v">{t.v}</div>
              <div className="d">{t.d}</div>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>
        <div className="note mt">
          You are never shown a candidate&apos;s phone number, email or documents — only that
          someone you referred progressed. <Clause>PART-08 / PART-09</Clause>
        </div>
      </main>
    </>
  );
}
