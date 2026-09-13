import {PlacementSummary} from './placement-summary';
import {Suspense} from 'react';
import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime, now } from '@/lib/clock';
import { Clause, StatusPill } from '../ui';
import { Icon } from './icons';

export const dynamic = 'force-dynamic';

/** Circumference of the donut's circle — r=54 in a 120×120 box. */
const DONUT_C = 2 * Math.PI * 54;

function istParts(at: Date) {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(at);
  return {
    date: fmt({ weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
    time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
    hour: Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(at)),
  };
}

/** Date only — the "Added" column has no room for a time, and doesn't need one. */
function shortDate(d: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(d));
}

/** Operations dashboard — the day's shape, and what still needs a person. */
export default async function OpsDashboard() {
  const viewer = await scopePage('ops');

  const [[c], [funnel], jobStatus, employers, recent, at] = await Promise.all([
    sql<{
      emp_pending: string; emp_total: string; par_pending: string; par_total: string;
      job_pending: string; job_live: string; attr_review: string; fraud_open: string;
      repl_pending: string; dr_open: string; dr_due_soon: string; cfg_sandbox: string;
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
        (SELECT COUNT(*) FROM app.role_configuration WHERE status IN ('SANDBOX','DRAFT'))::text AS cfg_sandbox`,
    sql<{ registered: string; assessed: string; applied: string; shortlisted: string; hired: string }[]>`
      SELECT
        (SELECT COUNT(*) FROM app.candidate WHERE status<>'DELETED_BLOCKED')::text AS registered,
        (SELECT COUNT(DISTINCT candidate_id) FROM app.assessment_attempt)::text AS assessed,
        (SELECT COUNT(DISTINCT candidate_id) FROM app.application)::text AS applied,
        (SELECT COUNT(DISTINCT candidate_id) FROM app.application
          WHERE status IN ('SHORTLISTED','CONTACTED','INTERVIEW','SELECTED','JOINED'))::text AS shortlisted,
        (SELECT COUNT(DISTINCT candidate_id) FROM app.application WHERE status='JOINED')::text AS hired`,
    sql<{ bucket: string; n: string }[]>`
      SELECT CASE
               WHEN status='LIVE' THEN 'Open'
               WHEN status IN ('DRAFT','PENDING_APPROVAL') THEN 'In review'
               WHEN status IN ('PAUSED','SUSPENDED') THEN 'On hold'
               ELSE 'Closed' END AS bucket,
             COUNT(*)::text AS n
        FROM app.job GROUP BY 1`,
    sql<{ id: string; brand_name: string; legal_name: string; gst_pan: string | null; status: string; jobs: string; created_at: Date }[]>`
      SELECT e.id, e.brand_name, e.legal_name, e.gst_pan, e.status, e.created_at,
             (SELECT COUNT(*)::text FROM app.job j WHERE j.employer_id=e.id) AS jobs
        FROM app.employer_organisation e ORDER BY e.created_at DESC, e.id DESC LIMIT 5`,
    sql<{ id: string; actor_role: string; event: string; entity_id: string | null; created_at: Date }[]>`
      SELECT id, actor_role, event, entity_id, created_at FROM app.audit_log
       ORDER BY created_at DESC, id DESC LIMIT 6`,
    now(),
  ]);

  const clock = istParts(at);
  const greeting = clock.hour < 12 ? 'Good morning' : clock.hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = viewer.role === 'ADMIN' ? 'Administrator' : 'Operations';

  const stages = [
    { k: 'Registered', n: Number(funnel.registered), tint: 'blue' },
    { k: 'Assessed', n: Number(funnel.assessed), tint: 'green' },
    { k: 'Applied', n: Number(funnel.applied), tint: 'amber' },
    { k: 'Shortlisted', n: Number(funnel.shortlisted), tint: 'purple' },
    { k: 'Hired', n: Number(funnel.hired), tint: 'pink' },
  ];
  const base = stages[0].n || 1;

  const BUCKETS = [
    { k: 'Open', color: 'var(--chart-1)' },
    { k: 'In review', color: 'var(--chart-2)' },
    { k: 'Closed', color: 'var(--chart-3)' },
    { k: 'On hold', color: 'var(--chart-4)' },
  ];
  const jobs = BUCKETS.map((b) => ({ ...b, n: Number(jobStatus.find((r) => r.bucket === b.k)?.n ?? 0) }));
  const jobTotal = jobs.reduce((a, b) => a + b.n, 0);
  let sweep = 0;
  const arcs = jobs.filter((b) => b.n > 0).map((b) => {
    const len = (b.n / (jobTotal || 1)) * DONUT_C;
    const arc = { ...b, len, offset: -sweep };
    sweep += len;
    return arc;
  });

  const queue = [
    { n: c.emp_pending, t: `${c.emp_total} total`, k: 'Employers awaiting verification', href: '/ops/employers', icon: 'employers', tint: 'blue' },
    { n: c.par_pending, t: `${c.par_total} total`, k: 'Partners awaiting verification', href: '/ops/partners', icon: 'partners', tint: 'purple' },
    { n: c.job_pending, t: `${c.job_live} live`, k: 'Jobs awaiting approval', href: '/ops/jobs', icon: 'jobs', tint: 'amber' },
    { n: c.attr_review, t: 'first valid source wins', k: 'Referral disputes', href: '/ops/attribution', icon: 'referrals', tint: 'cyan' },
    { n: c.repl_pending, t: '72-hour window', k: 'Replacement claims', href: '/ops/replacements', icon: 'hourglass', tint: 'green' },
    { n: c.fraud_open, t: 'self-endorsement, suspended sites', k: 'Open fraud cases', href: '/ops/fraud', icon: 'shield', tint: 'pink' },
    { n: c.dr_open, t: `${c.dr_due_soon} due within 30 days`, k: 'Data requests open', href: '/ops/data-requests', icon: 'applications', tint: 'blue' },
    { n: c.cfg_sandbox, t: 'unpublished', k: 'Sandbox configurations', href: '/ops/configurations', icon: 'configurations', tint: 'amber' },
  ];

  const actions = [
    { k: 'Add employer', href: '/ops/new-employer', icon: 'employers', tint: 'blue' },
    { k: 'Add partner', href: '/ops/new-partner', icon: 'partners', tint: 'green' },
    { k: 'Post a job', href: '/ops/employers', icon: 'jobs', tint: 'amber' },
    { k: 'Start a candidate journey', href: '/wa', icon: 'candidates', tint: 'purple' },
  ];

  return (
    <main className="ops-page">
      <div className="ops-greet">
        <div>
          <h1>{greeting}, {who}</h1>
          <div className="sub">Everything below needs a person. Each queue is its own screen. <Clause>§10.5</Clause></div>
        </div>
        <div className="ops-date">
          <Icon name="calendar" size={20} />
          <div>
            <strong>{clock.date}</strong>
            <span>{clock.time} IST · demo clock</span>
          </div>
        </div>
      </div>

      <Suspense fallback={<p className="muted">Loading placement totals…</p>}><PlacementSummary /></Suspense>

      <div className="card">
        <div className="card-head">
          <h2>Application funnel</h2>
          <span className="small muted">candidate registration through to hire</span>
        </div>
        <div className="card-body">
          <div className="funnel">
            {stages.map((s) => (
              <div key={s.k}>
                <div className="funnel-step" style={{ ['--tint-bg' as string]: `var(--tint-${s.tint}-bg)` }}>
                  <div className="v">{s.n}</div>
                  <div className="k">{s.k}</div>
                </div>
                <div className="funnel-track" style={{ ['--tint-ic' as string]: `var(--tint-${s.tint}-ic)` }}>
                  <i style={{ width: `${Math.round((s.n / base) * 100)}%` }} />
                </div>
                <div className="funnel-pct">{Math.round((s.n / base) * 100)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ops-cols c2even">
        <div className="card">
          <div className="card-head"><h2>Jobs by status</h2><Link className="btn btn-sm" href="/ops/jobs">View all</Link></div>
          <div className="card-body">
            {jobTotal === 0 ? <div className="empty">No jobs yet.</div> : (
              <div className="donut-wrap">
                <div className="donut">
                  <svg viewBox="0 0 120 120" width="150" height="150">
                    <circle cx="60" cy="60" r="54" fill="none" stroke="var(--surface-3)" strokeWidth="16" />
                    {arcs.map((a) => (
                      <circle key={a.k} cx="60" cy="60" r="54" fill="none" stroke={a.color} strokeWidth="16"
                              strokeDasharray={`${a.len} ${DONUT_C - a.len}`} strokeDashoffset={a.offset} />
                    ))}
                  </svg>
                  <div className="donut-mid"><div><strong>{jobTotal}</strong><span>total jobs</span></div></div>
                </div>
                <div className="donut-legend">
                  {jobs.map((b) => (
                    <div key={b.k}><i style={{ background: b.color }} />{b.k}<b>{b.n}</b></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Quick actions</h2></div>
          <div className="card-body">
            <div className="qa-grid">
              {actions.map((a) => (
                <Link key={a.href} href={a.href} className="qa" style={{
                  ['--tint-bg' as string]: `var(--tint-${a.tint}-bg)`,
                  ['--tint-ic' as string]: `var(--tint-${a.tint}-ic)`,
                }}>
                  <span className="ic"><Icon name={a.icon} size={18} /></span>
                  {a.k}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ops-cols c2">
        <div className="card">
          <div className="card-head"><h2>Recent employers</h2><Link className="btn btn-sm" href="/ops/employers">View all</Link></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>ID</th><th>Employer</th><th>GST / PAN</th><th className="num">Jobs</th><th>Status</th><th>Added</th></tr></thead>
              <tbody>
                {employers.map((e) => (
                  <tr key={e.id}>
                    <td className="id">{e.id}</td>
                    <td><Link href={`/ops/employers/${e.id}/edit`}><strong>{e.brand_name}</strong></Link>
                      <div className="small muted">{e.legal_name}</div></td>
                    <td className="small mono">{e.gst_pan ?? '—'}</td>
                    <td className="num">{e.jobs}</td>
                    <td><StatusPill status={e.status} /></td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{shortDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Needs attention</h2></div>
          <div className="card-body tight">
            <div className="attn-list">
              {queue.map((q) => (
                <Link key={q.href + q.k} href={q.href} className="attn-row" style={{
                  ['--tint-bg' as string]: `var(--tint-${q.tint}-bg)`,
                  ['--tint-ic' as string]: `var(--tint-${q.tint}-ic)`,
                }}>
                  <span className="ic"><Icon name={q.icon} size={16} /></span>
                  <span className="k">{q.k}<div className="t">{q.t}</div></span>
                  <span className={Number(q.n) > 0 ? 'n' : 'n zero'}>{q.n}</span>
                  <span className="go"><Icon name="chevron" size={16} /></span>
                </Link>
              ))}
            </div>
          </div>
        </div>
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
  );
}
