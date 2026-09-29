import { redirect } from 'next/navigation';
import { getSession, getBrief, loadSessionFor } from '@/modules/roleplay/service';
import { publicBrief } from '@/modules/roleplay/service/registry';
import { loadBundle } from '@/modules/roleplay/service/sessions';
import { withActor, WhoAmI, SignInFirst } from '../../shared';
import { PracticeClient } from './practice-client';
export const dynamic = 'force-dynamic';

export default async function PracticeSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  let session;
  try { session = await getSession(actor, id); } catch { return <main className="page"><h1>Practice not found</h1></main>; }
  if (session.state !== 'active') redirect(`/roleplay/s/${id}/report`);
  const row = await loadSessionFor(actor, id);
  const brief = publicBrief(row.scenario_version_id, await loadBundle(row.tenant_id, row.scenario_version_id, row.bundle_hash));
  void getBrief;
  return <main className="page">
    <div className="page-head"><div className="nd-section-kicker">{brief.product} · {brief.skill}{session.is_preview ? ' · PREVIEW (test session, not counted)' : ''}</div><h1>{brief.title}</h1></div>
    <WhoAmI actor={actor} />
    <PracticeClient initial={JSON.parse(JSON.stringify(session))} brief={{ ...brief, learner_brief: session.learner_brief ?? brief.learner_brief }} />
  </main>;
}
