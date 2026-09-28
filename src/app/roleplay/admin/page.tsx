import Link from 'next/link';
import { listDrafts, listVersions } from '@/modules/roleplay/service';
import { fmtDateTime } from '@/lib/clock';
import { withActor, WhoAmI, SignInFirst, Denied } from '../shared';
import { Pill } from '../../ui';
import { ImportDraft, VersionActions } from './admin-client';
export const dynamic = 'force-dynamic';

export default async function Builder() {
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  if (!actor.roles.some((r) => r === 'author' || r === 'reviewer')) return <Denied actor={actor} need="author or reviewer" />;
  const [drafts, versions] = await Promise.all([listDrafts(actor), listVersions(actor)]);
  return <main className="page">
    <div className="page-head"><div className="nd-section-kicker">Configuration, not code</div><h1>Scenario builder</h1>
      <p>Scenarios, personas, hidden facts, disclosure rules, rubrics, risk rules and scoring are versioned configuration. A draft is validated, submitted, reviewed by someone else, and published as an immutable version. Running sessions stay pinned to the version they started on.</p></div>
    <WhoAmI actor={actor} />
    <div className="grid g2 mb">
      <section className="card"><div className="card-head"><h2>Drafts</h2></div><div className="card-body tight"><div className="tblwrap"><table>
        <thead><tr><th>Scenario</th><th>Version</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{drafts.map((d: any) => <tr key={d.id}><td><Link href={`/roleplay/admin/drafts/${d.id}`}>{d.title ?? d.scenario_id}</Link><div className="small muted">{d.scenario_id}</div></td><td>{d.version}{d.base_version && <div className="small muted">from {d.base_version}</div>}</td>
          <td><Pill tone={d.status === 'in_review' ? 'warn' : 'mute'}>{d.status.replace('_', ' ')}</Pill>{d.review_note && <div className="small">Note: {d.review_note}</div>}</td><td className="small">{fmtDateTime(d.updated_at)}</td></tr>)}
          {!drafts.length && <tr><td colSpan={4} className="muted">No open drafts.</td></tr>}</tbody>
      </table></div></div></section>
      <section className="card"><div className="card-head"><h2>Import a scenario bundle (JSON)</h2></div><div className="card-body">{actor.roles.includes('author') ? <ImportDraft /> : <p className="muted">Authors import and edit; you can review and publish.</p>}</div></section>
    </div>
    <section className="card"><div className="card-head"><h2>Published versions</h2></div><div className="card-body tight"><div className="tblwrap"><table>
      <thead><tr><th>Scenario</th><th>Version</th><th>Status</th><th>Rubric · scoring</th><th>Digest</th><th></th></tr></thead>
      <tbody>{versions.map((v: any) => <tr key={v.id}><td>{v.title}<div className="small muted">{v.scenario_id}</div></td><td>{v.version}</td>
        <td><Pill tone={v.status === 'published' ? 'ok' : 'mute'}>{v.status}</Pill>{v.retired_reason && <div className="small">{v.retired_reason}</div>}</td>
        <td className="small">{v.rubric_version}<br />{v.scoring_version}</td><td className="small mono">{String(v.bundle_hash).slice(0, 12)}</td>
        <td><VersionActions versionId={v.id} scenarioId={v.scenario_id} version={v.version} canAuthor={actor.roles.includes('author')} canReview={actor.roles.includes('reviewer')} retired={v.status !== 'published'} /></td></tr>)}</tbody>
    </table></div></div></section>
  </main>;
}
