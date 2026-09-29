import Link from 'next/link';
import { publicScenarios, getBrief, LIMITS } from '@/modules/roleplay/service';
import { withActor, WhoAmI, SignInFirst } from './shared';
import { StartButton } from './start-button';
import { Pill } from '../ui';
export const dynamic = 'force-dynamic';

export default async function PracticeHome() {
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  if (!actor.roles.includes('learner')) return <main className="page"><div className="page-head"><h1>Practice coach</h1><p>Your current identity has no learner role. Use the builder, review queue or analytics, or switch to a learner account.</p></div><WhoAmI actor={actor} /></main>;
  const scenarios = await publicScenarios(actor);
  const briefs = await Promise.all(scenarios.map((s) => getBrief(actor, s.scenario_id)));
  return <main className="page">
    <div className="page-head"><div className="nd-section-kicker">Practise before the real conversation</div><h1>Practice coach</h1>
      <p>Talk to an AI customer who answers only what you ask. When you finish, a separate evaluator scores the conversation against a published rubric, with evidence quoted from your own words, and you get a focused plan for your next attempt.</p></div>
    <WhoAmI actor={actor} />
    <div className="note mb small">Before you start: messages up to {LIMITS.max_message_chars} characters, up to {LIMITS.max_learner_turns} messages, and a practice ends if left idle for {LIMITS.idle_expiry_minutes} minutes. There is no hard time limit. Use made-up details only; never enter real account numbers or ID documents.</div>
    {briefs.length === 0 && <p className="muted">No published scenarios yet.</p>}
    <div className="grid g2">{briefs.map((b) => <section className="card" key={b.scenario_id}>
      <div className="card-head"><h2>{b.title}</h2></div>
      <div className="card-body">
        <div className="tags mb"><Pill tone="info">{b.product}</Pill><Pill>{b.skill}</Pill><Pill>{b.difficulty}</Pill><Pill>{b.target_minutes.min}–{b.target_minutes.max} min</Pill><Pill>v{b.version}</Pill></div>
        <p><strong>You are:</strong> {b.learner_role}. <strong>Customer:</strong> {b.customer.name}, {b.customer.role.toLowerCase()}.</p>
        {b.languages?.length ? <StartButton scenarioId={b.scenario_id} languages={b.languages} /> : <><p>{b.learner_brief}</p><StartButton scenarioId={b.scenario_id} /></>}
      </div>
    </section>)}</div>
    <p className="mt"><Link href="/roleplay/attempts">See all my attempts →</Link></p>
  </main>;
}
