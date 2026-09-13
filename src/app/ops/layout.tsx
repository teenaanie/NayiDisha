import Link from 'next/link';
import {identity} from '@/lib/auth';
import {OpsSidebar} from './sidebar';
import {Icon} from './icons';

/**
 * Shell for every /ops screen: persistent left sidebar instead of the top tab
 * strip the other roles still use. Pages render their own content into
 * `{children}` and no longer render `<SubNav/>` themselves.
 */
export default async function OpsLayout({children}: {children: React.ReactNode}) {
  const actor = await identity();
  const role = actor?.role === 'ADMIN' ? 'Administrator' : 'Operations';

  return (
    <div className="ops-shell">
      <aside className="ops-side">
        <Link href="/ops" className="ops-brand">
          <strong>NayiDisha</strong>
          <span>Jobs. Skills. Better futures.</span>
        </Link>

        <OpsSidebar />

        <div className="ops-help">
          <Icon name="help" size={20} />
          <div>
            <strong>Need help?</strong>
            <p>Every queue below is a person&rsquo;s decision — nothing here decides on its own.</p>
          </div>
        </div>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          {/* Present for shape; a real cross-entity search is not built yet, so it
              is deliberately inert rather than returning invented results. */}
          <div className="ops-search" aria-hidden="true">
            <Icon name="search" size={16} />
            <span>Search is not wired up yet</span>
          </div>
          <div className="ops-topbar-right">
            <span className="ops-iconbtn" aria-hidden="true"><Icon name="bell" size={18} /></span>
            <div className="ops-user">
              <span className="ops-avatar">{role[0]}</span>
              <div>
                <strong>{actor?.id ?? '—'}</strong>
                <span>{role}</span>
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
