import Link from 'next/link';
import { scoreHeadline } from '../score';
import { sql } from '@/lib/db';
import { listReviewQueue } from '@/modules/roleplay/service';
import { fmtDateTime } from '@/lib/clock';
import { withActor, WhoAmI, SignInFirst, Denied } from '../shared';
import { ReviewForm } from './review-client';
export const dynamic = 'force-dynamic';

export default async function Reviews() {
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  if (!actor.roles.includes('reviewer')) return <Denied actor={actor} need="reviewer" />;
  const queue = await listReviewQueue(actor);
  const details = await Promise.all(queue.map(async (q: any) => ({
    q,
    findings: await sql`SELECT f.rule_id, f.status, f.severity, f.source, e.learner_spans FROM rp.risk_finding f LEFT JOIN rp.evidence e ON e.run_id = f.run_id AND e.id = f.evidence_ids->>0 WHERE f.run_id = ${q.id}`,
    dims: await sql`SELECT dimension_id, score, rationale FROM rp.dimension_score WHERE run_id = ${q.id} ORDER BY dimension_id`,
  })));
  return <main className="page">
    <div className="page-head"><h1>Review queue</h1><p>Assessments with consequential or ambiguous findings wait here. A review flag is a training-risk classification, not a legal conclusion. Your decision is recorded with the original result, and the learner then receives a final report.</p></div>
    <WhoAmI actor={actor} />
    {!queue.length && <p className="muted">Nothing to review.</p>}
    {details.map(({ q, findings, dims }) => <section className="card mb" key={q.id}>
      <div className="card-head"><h2>{q.learner} · {q.scenario_id} v{q.scenario_version}{q.kind === 'assessment' ? ' · graded assessment' : ''}</h2><span className="small muted">{fmtDateTime(q.created_at)} · provisional {scoreHeadline({ mode: q.score_mode, final_percent: q.final_percent, raw_total: q.raw_total, raw_max: q.raw_max, band_label: q.band_label })}</span></div>
      <div className="card-body">
        <ul className="small">{(q.review_reasons as unknown[]).filter((r) => typeof r === 'string').map((r, i) => <li key={i}>{String(r)}</li>)}</ul>
        <p><Link href={`/roleplay/s/${q.session_id}/report`}>Open transcript and evidence</Link></p>
        <ReviewForm runId={q.id} findings={JSON.parse(JSON.stringify(findings))} dims={JSON.parse(JSON.stringify(dims))} />
      </div>
    </section>)}
  </main>;
}
