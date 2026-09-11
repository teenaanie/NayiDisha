import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { creditBalance } from '@/modules/commercial';
import { Clause, Money } from '../ui';
import { SubNav, EMPLOYER_TABS } from '../subnav';

export const dynamic = 'force-dynamic';

export default async function EmployerDashboard() {
  const viewer=await scopePage('employer');
  const employerId = viewer.role==='ADMIN' ? 'EMP-001' : viewer.id;
  const [emp] = await sql<{ brand_name: string; status: string }[]>`
    SELECT brand_name, status FROM app.employer_organisation WHERE id=${employerId}`;

  const [c] = await sql<{
    live: string; pending: string; qualified: string; unlocked: string;
    interviews: string; awaiting_confirm: string; offers: string; docs_pending: string;
    joined: string; contacted: string;
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM app.job WHERE employer_id=${employerId} AND status='LIVE')::text AS live,
      (SELECT COUNT(*) FROM app.job WHERE employer_id=${employerId} AND status='PENDING_APPROVAL')::text AS pending,
      (SELECT COUNT(*) FROM app.match_result m JOIN app.job j ON j.id=m.job_id
        JOIN app.application a ON a.id=m.application_id
        WHERE j.employer_id=${employerId} AND m.qualified AND a.reconfirmed_at IS NOT NULL
          AND a.status NOT IN ('WITHDRAWN','REJECTED')
          AND NOT EXISTS (SELECT 1 FROM app.qualified_lead_unlock u
                           WHERE u.job_id=m.job_id AND u.candidate_id=m.candidate_id))::text AS qualified,
      (SELECT COUNT(*) FROM app.qualified_lead_unlock WHERE employer_id=${employerId} AND status='CONFIRMED')::text AS unlocked,
      (SELECT COUNT(*) FROM app.interview i JOIN app.application a ON a.id=i.application_id
        JOIN app.job j ON j.id=a.job_id WHERE j.employer_id=${employerId})::text AS interviews,
      (SELECT COUNT(*) FROM app.interview i JOIN app.application a ON a.id=i.application_id
        JOIN app.job j ON j.id=a.job_id WHERE j.employer_id=${employerId}
          AND i.status='PROPOSED')::text AS awaiting_confirm,
      (SELECT COUNT(*) FROM app.onboarding_case o JOIN app.application a ON a.id=o.application_id
        JOIN app.job j ON j.id=a.job_id WHERE j.employer_id=${employerId})::text AS offers,
      (SELECT COUNT(*) FROM app.candidate_document d JOIN app.onboarding_case o ON o.id=d.onboarding_case_id
        JOIN app.application a ON a.id=o.application_id JOIN app.job j ON j.id=a.job_id
        WHERE j.employer_id=${employerId} AND d.status='UPLOADED')::text AS docs_pending,
      (SELECT COUNT(*) FROM app.application a JOIN app.job j ON j.id=a.job_id
        WHERE j.employer_id=${employerId} AND a.status='JOINED')::text AS joined,
      (SELECT COUNT(*) FROM app.optional_outcome_event o JOIN app.application a ON a.id=o.application_id
        JOIN app.job j ON j.id=a.job_id WHERE j.employer_id=${employerId})::text AS contacted
  `;

  const [creditRow]=await sql`SELECT COALESCE(sum(l.credit_delta),0) available FROM app.credit_ledger l JOIN app.posting_entitlement e ON e.id=l.entitlement_id JOIN app.job j ON j.id=e.job_id WHERE j.employer_id=${employerId} AND l.entry_type IN ('INCLUDED_GRANT','PURCHASE','UNLOCK_CONSUME','REPLACEMENT_RESTORE','EXPIRY')`;
  const credits=Number(creditRow.available);

  const tiles = [
    { k: 'Live vacancies', v: c.live, d: `${c.pending} awaiting approval`, href: '/employer/jobs' },
    { k: 'Qualified, not yet unlocked', v: c.qualified, d: 'reconfirmed and waiting', href: '/employer/jobs', attn: Number(c.qualified) > 0 },
    { k: 'Unlock credits available', v: credits, d: `${c.unlocked} profiles unlocked`, href: '/employer/billing' },
    { k: 'Interviews', v: c.interviews, d: `${c.awaiting_confirm} awaiting candidate confirmation`, href: '/employer/hiring', attn: Number(c.awaiting_confirm) > 0 },
    { k: 'Offers made', v: c.offers, d: `${c.docs_pending} documents to review`, href: '/employer/hiring', attn: Number(c.docs_pending) > 0 },
    { k: 'Outcomes recorded', v: c.contacted, d: `${c.joined} joined`, href: '/employer/outcomes' },
  ];

  return (
    <>
      <SubNav tabs={EMPLOYER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>{emp.brand_name}</h1>
          <div className="sub">
            Your organisation account <Clause>§10.3</Clause>
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
        <div className="note mt">
          Nothing on the hiring side changes what you are charged. An unlock is billed when you open
          a profile; interviews, offers and joining are recorded because they are useful to you, not
          because billing waits for them. <Clause>§6.7 · LEAD-10</Clause>
        </div>
      </main>
    </>
  );
}
