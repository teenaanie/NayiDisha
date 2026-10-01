import { managedTeams, managerAnalytics } from '@/modules/roleplay/service';
import { withActor, WhoAmI, SignInFirst, Denied } from '../shared';
import { Pill } from '../../ui';
export const dynamic = 'force-dynamic';

export default async function Manager({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  if (!actor.roles.includes('manager')) return <Denied actor={actor} need="manager" />;
  const teams = await managedTeams(actor);
  const { team } = await searchParams;
  const teamId = team ?? teams[0]?.id;
  const data = teamId ? await managerAnalytics(actor, { team_id: teamId }) : null;
  return <main className="page">
    <div className="page-head"><h1>Team analytics</h1><p>Only teams you manage. Results are grouped by scenario, rubric version and scoring version, and never mixed. One valid full assessment counts per session (first valid). Focused practice is reported separately. Groups under {data?.min_cohort ?? 5} learners are hidden to protect individuals. Readiness is advisory and never an automatic employment decision.</p></div>
    <WhoAmI actor={actor} />
    <nav className="btnrow mb" aria-label="Teams">{teams.map((t) => <a key={t.id} className={'btn' + (t.id === teamId ? ' btn-primary' : '')} href={`/roleplay/manager?team=${t.id}`}>{t.name}</a>)}</nav>
    {!data?.groups.length && <p className="muted">No practice in this window.</p>}
    {data?.groups.map((g) => <section className="card mb" key={`${g.scenario_id}${g.rubric_version}${g.scoring_version}`}>
      <div className="card-head"><h2>{g.scenario_id}</h2><span className="small muted">{g.rubric_version} · {g.scoring_version}</span></div>
      <div className="card-body">
        <div className="tags mb"><Pill>{g.learners} learners</Pill><Pill>{g.counts.started_full} started</Pill><Pill tone="ok">{g.counts.reported_full} reported</Pill><Pill>{g.counts.abandoned} abandoned</Pill><Pill>{g.counts.processing} processing</Pill><Pill>{g.counts.focused_attempts} focused</Pill></div>
        {g.suppressed || !g.metrics ? <p className="note">Hidden: fewer than {data.min_cohort} learners in this group.</p> : <div className="grid g2">
          <div><p><strong>Completion:</strong> {g.metrics.completion_rate}% · <strong>Average:</strong> {g.metrics.average_percent}/100 <span className="small muted">(raw {g.metrics.average_raw}/{g.metrics.raw_max})</span></p>
            <p><strong>Risk rate:</strong> {g.metrics.risk_rate}% of assessed sessions · {g.metrics.pending_review} pending review</p>
            <p><strong>Retry improvement:</strong> {g.metrics.retry_improvement.pairs ? `${g.metrics.retry_improvement.average_delta} points (out of 100) over ${g.metrics.retry_improvement.pairs} paired attempts, ~${g.metrics.retry_improvement.average_days_between} days apart` : 'no paired full retries yet'}</p>
            <h3>Skill averages</h3><div className="bars">{Object.entries(g.metrics.dimension_averages).map(([d, v]) => <div className="bar" key={d}><span>{d}</span><span className="track"><span className="fill" style={{ width: `${((v as number) / 5) * 100}%` }} /></span><span className="val">{v as number}</span></div>)}</div></div>
          <div><h3>Questions asked (share of assessed sessions)</h3><div className="bars">{Object.entries(g.metrics.coverage_rates).sort((a, b) => (a[1] as number) - (b[1] as number)).map(([c, v]) => <div className="bar" key={c}><span>{c}</span><span className="track"><span className="fill" style={{ width: `${v}%` }} /></span><span className="val">{v as number}%</span></div>)}</div>
            <h3>Readiness (advisory)</h3><div className="tags">{g.metrics.readiness_advisory.map((r) => <Pill key={r.band}>{r.band}: {r.learners}</Pill>)}</div></div>
        </div>}
      </div>
    </section>)}
  </main>;
}
