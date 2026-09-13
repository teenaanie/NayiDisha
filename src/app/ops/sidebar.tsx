'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {OPS_TABS} from '../subnav';
import {Icon} from './icons';

/** Icon per Ops route — keyed by href so it stays aligned if OPS_TABS is reordered. */
const ICON_FOR: Record<string, string> = {
  '/ops': 'dashboard',
  '/ops/employers': 'employers',
  '/ops/partners': 'partners',
  '/ops/candidates': 'candidates',
  '/ops/matches': 'matches',
  '/ops/exceptions': 'exceptions',
  '/ops/credit-requests': 'credits',
  '/ops/manage': 'manage',
  '/ops/configurations': 'configurations',
  '/ops/jobs': 'jobs',
  '/ops/attribution': 'referrals',
  '/ops/replacements': 'hourglass',
  '/ops/fraud': 'shield',
  '/ops/data-requests': 'applications',
  '/ops/audit': 'audit',
};

export function OpsSidebar() {
  const path = usePathname();
  return (
    <nav className="ops-nav" aria-label="Operations">
      {OPS_TABS.map((t) => {
        const active = path === t.href || (t.href !== '/ops' && path.startsWith(t.href + '/'))
          || (t.href === '/ops/manage' && path.startsWith('/ops/manage'));
        return (
          <Link prefetch={false} key={t.href} href={t.href}
                className={active ? 'ops-nav-item active' : 'ops-nav-item'}
                aria-current={active ? 'page' : undefined} title={t.hint}>
            <Icon name={ICON_FOR[t.href] ?? 'chevron'} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
