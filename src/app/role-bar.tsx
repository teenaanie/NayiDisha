'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Role switcher required by §21.2 — one browser, every persona. */
const ROLES = [
  { href: '/sign-in', label: 'Sign in / out' },
  { href: '/demo', label: 'Demo identities' },
  { href: '/', label: 'Overview' },
  { href: '/ops', label: 'Operations' },
  { href: '/employer', label: 'Employer' },
  { href: '/partner', label: 'Partner' },
  { href: '/finance', label: 'Finance' },
  { href: '/wa', label: 'Candidate (WhatsApp)' },
];

export function RoleBar() {
  const path = usePathname();
  return (
    <nav className="rolebar" aria-label="Role switcher">
      <span className="brand">NayiDisha</span>
      {ROLES.map((r) => {
        const active = r.href === '/' ? path === '/' : path.startsWith(r.href);
        return (
          <Link prefetch={false} key={r.href} href={r.href} className={active ? 'active' : ''}>
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}
