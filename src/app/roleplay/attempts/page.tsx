import Link from 'next/link';
import { listMySessions } from '@/modules/roleplay/service';
import { fmtDateTime } from '@/lib/clock';
import { withActor, WhoAmI, SignInFirst } from '../shared';
import { Pill } from '../../ui';
export const dynamic = 'force-dynamic';

const label: Record<string, string> = { active: 'In progress', completed: 'Finished', evaluating: 'Being assessed', coaching: 'Preparing feedback', review_required: 'Awaiting review', reported: 'Report ready', report_partial: 'Score ready (feedback pending)', evaluation_failed: 'Assessment failed', abandoned: 'Abandoned' };

export default async function Attempts() {
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  const rows = await listMySessions(actor);
  return <main className="page">
    <div className="page-head"><h1>My attempts</h1><p>Every attempt is kept. A retry never replaces the original, and focused practice is shown separately from full scores.</p></div>
    <WhoAmI actor={actor} />
    <section className="card"><div className="card-body tight"><div className="tblwrap"><table>
      <thead><tr><th>Started</th><th>Scenario</th><th>Kind</th><th>Status</th><th>Result</th><th></th></tr></thead>
      <tbody>{rows.map((r: any) => <tr key={r.id}>
        <td className="small">{fmtDateTime(r.started_at)}</td>
        <td className="small">{r.title} <span className="muted">v{r.scenario_version}</span></td>
        <td>{r.is_preview ? <Pill tone="warn">preview (test)</Pill> : r.retry_mode ? <Pill tone="info">{r.retry_mode} retry</Pill> : <Pill>first attempt</Pill>}</td>
        <td className="small">{label[r.state] ?? r.state}</td>
        <td className="num">{r.retry_mode === 'focused' ? 'focused practice' : r.raw_total ? `${r.raw_total}/${r.raw_max} · ${r.band_label}` : '—'}</td>
        <td>{r.state === 'active' ? <Link href={`/roleplay/s/${r.id}`}>Continue</Link> : r.state !== 'abandoned' ? <Link href={`/roleplay/s/${r.id}/report`}>Report</Link> : null}</td>
      </tr>)}</tbody>
    </table></div></div></section>
  </main>;
}
