import Link from 'next/link';
import { getDraft, validateDraft } from '@/modules/roleplay/service';
import { withActor, WhoAmI, SignInFirst, Denied } from '../../../shared';
import { DraftEditor } from './draft-client';
export const dynamic = 'force-dynamic';

export default async function Draft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await withActor();
  if (!actor) return <SignInFirst />;
  if (!actor.roles.some((r) => r === 'author' || r === 'reviewer')) return <Denied actor={actor} need="author or reviewer" />;
  let d;
  try { d = await getDraft(actor, id); } catch { return <main className="page"><h1>Draft not found</h1><Link href="/roleplay/admin">Back</Link></main>; }
  const validation = await validateDraft(actor, id);
  return <main className="page">
    <div className="page-head"><div className="nd-section-kicker"><Link href="/roleplay/admin">Scenario builder</Link> · draft</div><h1>{d.bundle?.scenario?.title ?? d.scenario_id}</h1></div>
    <WhoAmI actor={actor} />
    <DraftEditor draft={JSON.parse(JSON.stringify(d))} initialValidation={JSON.parse(JSON.stringify(validation))} canAuthor={actor.roles.includes('author')} canReview={actor.roles.includes('reviewer')} />
  </main>;
}
