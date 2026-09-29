import Link from 'next/link';
import { getReport } from '@/modules/roleplay/service';
import { withActor, WhoAmI, SignInFirst } from '../../../shared';
import { Pill } from '../../../../ui';
import { Poll, RetryButtons, RetryAssessment } from './report-client';
export const dynamic = 'force-dynamic';

type Span = { turn_id: string; start: number; end: number; quote: string };
type Ev = { id: string; check_id: string | null; status: string; learner_spans: Span[]; explanation: string };
type Finding = { text: string; evidence_ids: string[]; suggested_question: string | null };

/** Turn text with cited spans highlighted; offsets are code points (spec §14). */
function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  const cps = Array.from(text);
  const marks = new Array(cps.length).fill(false);
  for (const s of spans) for (let i = s.start; i < s.end && i < cps.length; i++) marks[i] = true;
  const out: React.ReactNode[] = []; let buf = ''; let on = false;
  cps.forEach((c, i) => { if (marks[i] !== on) { out.push(on ? <mark className="rp-evidence" key={i}>{buf}</mark> : buf); buf = ''; on = marks[i]; } buf += c; });
  out.push(on ? <mark className="rp-evidence" key="end">{buf}</mark> : buf);
  return <>{out}</>;
}

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  let r;
  try { r = await getReport(actor, id); } catch (e) { return <main className="page"><h1>Report not available</h1><p>{(e as Error).message}</p><Link href="/roleplay">Back to practice</Link></main>; }
  if (r.status === 202) return <main className="page"><div className="page-head"><h1>Assessing your conversation…</h1><p>A separate evaluator is reading your transcript. This page updates by itself.</p></div><Poll sessionId={id} /></main>;
  const b = r.body as any;
  if (b.state === 'evaluation_failed') {
    const canRetry = actor.roles.some((x) => x === 'reviewer' || x === 'tenant_admin');
    return <main className="page"><div className="page-head"><h1>Your conversation is saved</h1><p>It could not be assessed automatically. No score was produced; {canRetry ? 'you can retry the assessment on the same transcript.' : 'an administrator can retry the assessment on the same transcript.'}</p>
      {canRetry && b.assessment_id && <RetryAssessment assessmentId={b.assessment_id} />}</div><WhoAmI actor={actor} /></main>;
  }
  const rep = b.report ?? {};
  const evidence = new Map<string, Ev>((b.evidence as Ev[]).map((e) => [e.id, e]));
  const cite = (f: Finding) => f.evidence_ids.flatMap((eid) => evidence.get(eid)?.learner_spans ?? []).slice(0, 2);
  const spans = (b.evidence as Ev[]).filter((e) => e.status === 'observed' || e.status === 'contradicted').flatMap((e) => e.learner_spans);
  const FindingList = ({ title, items }: { title: string; items: Finding[] }) => items?.length ? <div className="mb"><h3>{title}</h3><ul>{items.map((f, i) => <li key={i}>{f.text}
    {cite(f).map((s, j) => <span key={j}> <a href={`#turn-${s.turn_id}`} className="small">[evidence]</a></span>)}
    {f.suggested_question && <div className="small muted">Try: “{f.suggested_question}”</div>}</li>)}</ul></div> : null;
  const score = rep.score;
  return <main className="page">
    <div className="page-head"><div className="nd-section-kicker">{b.scenario.title} · v{b.scenario.version}{b.mode === 'focused' ? ' · focused practice' : ''}</div>
      <h1>{b.mode === 'focused' ? 'Focused practice results' : score ? `${score.raw_total}/${score.raw_max} · ${score.band_label}` : 'Report'}</h1>
      {score && score.mode === 'weighted_percent' && <p>{score.final_percent}% weighted{score.adjustments?.length ? ` (base ${score.base_percent}%; ${score.adjustments.map((a: any) => a.detail).join('; ')})` : ''}</p>}
    </div>
    <WhoAmI actor={actor} />
    {b.report_status === 'provisional' && <div className="note warn mb"><strong>Provisional.</strong> A reviewer must confirm part of this assessment before it is final: {(b.review_reasons as unknown[]).filter((x) => typeof x === 'string').join(' ')}</div>}
    {b.report_status === 'partial' && <div className="note warn mb"><strong>Feedback is delayed.</strong> Your verified score and evidence are below; written coaching will be added when the coach is available.</div>}
    {b.comparable === false && <div className="note mb">This attempt used a different scenario version than the one it retries, so its score is not directly comparable.</div>}

    {b.mode === 'focused' && rep.focused_results && <section className="card mb"><div className="card-head"><h2>Practice targets</h2></div><div className="card-body">
      <p className="small muted">Only these targets were assessed. Earlier turns were context and earn no credit. This is not a full score.</p>
      <div className="tags">{rep.focused_results.checks.map((c: any) => <Pill key={c.check_id} tone={c.status === 'observed' ? 'ok' : 'mute'}>{c.status === 'observed' ? '✓' : '○'} {(b.checks.find((x: any) => x.id === c.check_id)?.description) ?? c.check_id}</Pill>)}</div>
    </div></section>}

    {b.mode === 'full' && <section className="card mb"><div className="card-head"><h2>Rubric</h2><span className="small muted">Scored against anchors; totals calculated by the server</span></div><div className="card-body"><div className="bars">
      {b.dimensions.map((d: any) => <div key={d.dimension_id} className="mb">
        <div className="bar"><span>{d.name}</span><span className="track"><span className="fill" style={{ width: `${(d.score / d.max_score) * 100}%` }} /></span><span className="val">{d.score}/{d.max_score}</span></div>
        <p className="small"><strong>Anchor {d.score}:</strong> {d.anchor?.description} {d.anchor?.basis === 'recommendation' && <Pill>recommended anchor</Pill>}</p>
        <p className="small muted">{d.rationale}</p>
      </div>)}
    </div></div></section>}

    <div className="grid g2 mb">
      <section className="card"><div className="card-body">
        <FindingList title="What went well" items={rep.strengths} />
        {rep.best_moment && <FindingList title="Best moment" items={[rep.best_moment]} />}
        {!rep.strengths?.length && !rep.best_moment && <p className="muted small">No verified strength to highlight in this attempt.</p>}
      </div></section>
      <section className="card"><div className="card-body">
        <FindingList title="Priority improvements" items={rep.improvement_areas} />
        {rep.missed_opportunity && <FindingList title="Missed opportunity" items={[rep.missed_opportunity]} />}
      </div></section>
    </div>
    <section className="card mb"><div className="card-body">
      <FindingList title="Questions not asked" items={rep.missed_questions} />
      {rep.risky_statements?.length ? <FindingList title="Risky statements" items={rep.risky_statements} /> : <p>{rep.no_risk_statement ?? 'No configured risk detected in this transcript.'}</p>}
      <p className="small muted">Product and lending-policy accuracy was not assessed: no reviewed knowledge pack is configured.</p>
    </div></section>

    {(rep.retry_plans?.full || rep.retry_plans?.focused) && <section className="card mb"><div className="card-head"><h2>Practise again</h2></div><div className="card-body">
      <p>{rep.retry_plan?.instruction}</p>
      <RetryButtons sessionId={id} assessmentId={rep.assessment_id} full={rep.retry_plans.full} focused={rep.retry_plans.focused} />
    </div></section>}

    <details open><summary>Transcript with cited evidence</summary><div className="card-body">
      {b.transcript.map((t: any) => <p key={t.turn_id} id={`turn-${t.turn_id}`} className="rp-turn small">
        <strong>{t.speaker === 'customer' ? 'Customer' : 'You'}{t.origin === 'retry_prefix' ? ' (earlier, context)' : ''}{t.input_mode === 'voice' ? ` 🎤${t.asr_edited ? ' (spoken, corrected before sending)' : ' (spoken)'}` : ''}:</strong>{' '}
        {t.speaker === 'learner' ? <Highlighted text={t.text} spans={spans.filter((s) => s.turn_id === t.turn_id)} /> : t.text}</p>)}
    </div></details>
    <p className="small muted mt">Pinned: bundle {String(b.pinned.bundle_hash).slice(0, 12)} · rubric {b.pinned.rubric_version} · scoring {b.pinned.scoring_version} · transcript {String(b.pinned.transcript_hash).slice(0, 12)}</p>
  </main>;
}
