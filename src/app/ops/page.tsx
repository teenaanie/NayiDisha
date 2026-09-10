import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { Clause } from '../ui';
import { SubNav, OPS_TABS } from '../subnav';

export const dynamic = 'force-dynamic';

/** Operations dashboard — what needs attention, and where to go for it. */
export default async function OpsDashboard() {
  const viewer=await scopePage('ops');
  const [c] = await sql<{
    emp_pending: string; emp_total: string;
    par_pending: string; par_total: string;
    job_pending: string; job_live: string;
    attr_review: string; fraud_open: string; repl_pending: string;
    dr_open: string; dr_due_soon: string; cfg_sandbox: string; audit_today: string;
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM app.employer_organisation WHERE status='PENDING_REVIEW')::text AS emp_pending,
      (SELECT COUNT(*) FROM app.employer_organisation)::text AS emp_total,
      (SELECT COUNT(*) FROM app.partner WHERE status='PENDING_REVIEW')::text AS par_pending,
      (SELECT COUNT(*) FROM app.partner)::text AS par_total,
      (SELECT COUNT(*) FROM app.job WHERE status='PENDING_APPROVAL')::text AS job_pending,
      (SELECT COUNT(*) FROM app.job WHERE status='LIVE')::text AS job_live,
      (SELECT COUNT(*) FROM app.attribution WHERE status='UNDER_REVIEW')::text AS attr_review,
      (SELECT COUNT(*) FROM app.fraud_case WHERE status='OPEN')::text AS fraud_open,
      (SELECT COUNT(*) FROM app.replacement_case WHERE decision='PENDING')::text AS repl_pending,
      (SELECT COUNT(*) FROM app.data_request WHERE status='OPEN')::text AS dr_open,
      (SELECT COUNT(*) FROM app.data_request WHERE status='OPEN'
        AND due_at < (SELECT now_at FROM app.demo_clock WHERE id=1) + interval '30 days')::text AS dr_due_soon,
      (SELECT COUNT(*) FROM app.role_configuration WHERE status IN ('SANDBOX','DRAFT'))::text AS cfg_sandbox,
      (SELECT COUNT(*) FROM app.audit_log)::text AS audit_today
  `;

  const recent = await sql<{
    id: string; actor_role: string; event: string; entity_id: string | null; created_at: Date;
  }[]>`SELECT id, actor_role, event, entity_id, created_at FROM app.audit_log
        ORDER BY created_at DESC, id DESC LIMIT 8`;

  const queue = [
    { n: c.emp_pending, k: 'Employers awaiting verification', href: '/ops/employers', d: `${c.emp_total} total` },
    { n: c.par_pending, k: 'Partners awaiting verification', href: '/ops/partners', d: `${c.par_total} total` },
    { n: c.job_pending, k: 'Jobs awaiting approval', href: '/ops/jobs', d: `${c.job_live} live` },
    { n: c.attr_review, k: 'Referral disputes', href: '/ops/attribution', d: 'first valid source wins' },
    { n: c.repl_pending, k: 'Replacement claims', href: '/ops/replacements', d: '72-hour window' },
    { n: c.fraud_open, k: 'Open fraud cases', href: '/ops/fraud', d: 'self-endorsement, suspended sites' },
    { n: c.dr_open, k: 'Data requests open', href: '/ops/data-requests', d: `${c.dr_due_soon} due within 30 days` },
    { n: c.cfg_sandbox, k: 'Sandbox configurations', href: '/ops/configurations', d: 'unpublished' },
  ];

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Operations</h1>
          <div className="sub">
            Everything below needs a person. Each queue is its own screen. <Clause>§10.5</Clause>
          </div>
        </div>

        <div className="tilegrid mb">
          {queue.map((q) => (
            <Link key={q.href + q.k} href={q.href} className={`tile ${Number(q.n) > 0 ? 'attn' : ''}`}>
              <div className="k">{q.k}</div>
              <div className="v">{q.n}</div>
              <div className="d">{q.d}</div>
              <span className="go">Open →</span>
            </Link>
          ))}
        </div>

        <div className="card">
          <div className="card-head"><h2>Latest activity</h2><Clause>§14 Audit</Clause></div>
          <div className="card-body tight">
            <div className="tblwrap">
              <table>
                <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Entity</th></tr></thead>
                <tbody>
                  {recent.map((a) => (
                    <tr key={a.id}>
                      <td className="small muted">{fmtDateTime(a.created_at)}</td>
                      <td className="small">{a.actor_role.toLowerCase()}</td>
                      <td className="small">{a.event.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="id">{a.entity_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12 }}>
              <Link className="btn btn-sm" href="/ops/audit">Full audit explorer →</Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
