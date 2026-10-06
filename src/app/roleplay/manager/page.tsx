import Link from 'next/link';
import { managedTeams, managerAnalytics, listTeamAssessments } from '@/modules/roleplay/service';
import { RetakeButton } from './retake-button';
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
  const graded = await listTeamAssessments(actor);
  // The retake button belongs on each learner's latest attempt per scenario, once all allowed attempts are used.
  const latest = new Set<string>(); const seen = new Set<string>();
  for (const a of graded) { const k = `${a.learner_id}|${a.scenario_id}`; if (!seen.has(k)) { seen.add(k); latest.add(a.session_id); } }
  const STATE: Record<string, string> = { active: 'in progress', completed: 'scoring', evaluating: 'scoring', reported: 'scored', review_required: 'under review', evaluation_failed: 'scoring failed', abandoned: 'abandoned' };
  return <main className="page">
    <div className="page-head"><h1>Team analytics</h1><p>Only teams you manage. Results are grouped by scenario, rubric version and scoring version, and never mixed. One valid full assessment counts per session (first valid). Focused practice is reported separately. Groups under {data?.min_cohort ?? 5} learners are hidden to protect individuals. Readiness is advisory and never an automatic employment decision.</p></div>
    <WhoAmI actor={actor} />
    <nav className="btnrow mb" aria-label="Teams">{teams.map((t) => <a key={t.id} className={'btn' + (t.id === teamId ? ' btn-primary' : '')} href={`/roleplay/manager?team=${t.id}`}>{t.name}</a>)}</nav>
    <section className="card mb"><div className="card-head"><h2>Graded assessments</h2><span className="small muted">Score only for the learner; open one to see the transcript and evidence. One attempt per scenario unless you allow a retake.</span></div><div className="card-body tight">
      {!graded.length ? <p className="muted" style={{ padding: '10px 14px' }}>No graded assessments yet.</p> : <div className="tblwrap"><table>
        <thead><tr><th>Learner</th><th>Scenario</th><th>Taken</th><th className="num">Score</th><th>Status</th><th className="num">Attempts</th><th /></tr></thead>
        <tbody>{graded.map((a) => <tr key={a.session_id}>
          <td>{a.learner}</td>
          <td>{a.title} <span className="small muted">v{a.scenario_version}</span></td>
          <td>{new Date(a.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td className="num">{a.final_percent != null ? <Link href={`/roleplay/s/${a.session_id}/report`}>{Math.round(Number(a.final_percent))}/100 · {a.band_label}</Link> : '—'}</td>
          <td><Pill tone={a.state === 'reported' ? 'ok' : a.state === 'review_required' ? 'warn' : a.state === 'evaluation_failed' ? 'bad' : 'mute'}>{STATE[a.state] ?? a.state}</Pill></td>
          <td className="num">{a.attempts_used} of {a.attempts_allowed}</td>
          <td>{latest.has(a.session_id) && a.attempts_used >= a.attempts_allowed && !['active', 'completed', 'evaluating'].includes(a.state) && <RetakeButton learnerId={a.learner_id} scenarioId={a.scenario_id} learner={a.learner} />}</td>
        </tr>)}</tbody>
      </table></div>}
    </div></section>
    <h2>Practice analytics</h2>
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
