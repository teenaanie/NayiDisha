'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Second-level navigation within a role.
 *
 * Each role's landing page is a dashboard; every capability underneath it gets
 * its own route, so a single feature can be shown on its own rather than as
 * one band in a long scroll.
 */
export interface SubTab { href: string; label: string; hint?: string }

export function SubNav({ tabs }: { tabs: SubTab[] }) {
  const path = usePathname();
  const params = useSearchParams();
  // The partner console is viewed "as" a chosen partner; carrying that choice
  // across tabs is what stops the picker resetting on every click.
  const partner = params.get('p');
  const candidate = params.get('c');
  return (
    <nav className="subnav" aria-label="Section">
      {tabs.map((t) => {
        const active = path === t.href || (t.href === '/ops/manage' && path.startsWith('/ops/manage/'));
        const selected = t.href.startsWith('/partner') ? (partner ? '?p='+encodeURIComponent(partner) : '') : t.href.startsWith('/wa') && t.href!=='/wa' ? (candidate ? '?c='+encodeURIComponent(candidate) : '') : '';
        const href = t.href + selected;
        return (
          <Link prefetch={false} key={t.href} href={href} className={active ? 'active' : ''} title={t.hint}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const OPS_TABS: SubTab[] = [
  { href: '/ops', label: 'Dashboard' },
  { href: '/ops/manage', label: 'Manage & catalogue' },
  { href: '/ops/configurations', label: 'Configurations', hint: '§8.4A' },
  { href: '/ops/employers', label: 'Employers', hint: '§8.1' },
  { href: '/ops/partners', label: 'Partners', hint: '§8.2' },
  { href: '/ops/jobs', label: 'Job moderation', hint: 'JOB-02' },
  { href: '/ops/attribution', label: 'Attribution', hint: '§8.11' },
  { href: '/ops/replacements', label: 'Replacements', hint: 'LEAD-08' },
  { href: '/ops/fraud', label: 'Fraud', hint: 'REF-07' },
  { href: '/ops/data-requests', label: 'Data requests', hint: 'CAN-06' },
  { href: '/ops/audit', label: 'Audit', hint: '§14' },
];

export const EMPLOYER_TABS: SubTab[] = [
  { href: '/employer', label: 'Dashboard' },
  { href: '/employer/jobs', label: 'Jobs', hint: 'JOB-01' },
  { href: '/employer/hiring', label: 'Interviews & onboarding', hint: '§8.9 · §8.10' },
  { href: '/employer/billing', label: 'Billing & credits', hint: '§9' },
  { href: '/employer/outcomes', label: 'Outcomes', hint: 'LEAD-10' },
];

export const PARTNER_TABS: SubTab[] = [
  { href: '/partner', label: 'Dashboard' },
  { href: '/partner/sites', label: 'QR sites', hint: 'PART-05/06' },
  { href: '/partner/candidates', label: 'My candidates', hint: 'PART-08/09' },
  { href: '/partner/alerts', label: 'Job alerts', hint: 'ALT-03' },
  { href: '/partner/rewards', label: 'Rewards', hint: 'REF-08/10' },
  { href: '/partner/conduct', label: 'Conduct rules', hint: 'PART-07' },
];

export const FINANCE_TABS: SubTab[] = [
  { href: '/finance', label: 'Dashboard' },
  { href: '/finance/balances', label: 'Partner balances' },
  { href: '/finance/payouts', label: 'Payout batches', hint: 'REF-09' },
  { href: '/finance/ledger', label: 'Reward ledger', hint: 'REF-08' },
];

export const CANDIDATE_TABS: SubTab[] = [
  { href: '/wa', label: 'WhatsApp journey' },
  { href: '/wa/inbox', label: 'Alerts & messages', hint: 'ALT-04' },
  { href: '/wa/preferences', label: 'Profile & preferences', hint: 'CAN-04' },
  { href: '/wa/rights', label: 'My data', hint: 'CAN-06' },
];
