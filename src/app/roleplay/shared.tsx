import Link from 'next/link';
import { requestActor } from '@/modules/roleplay/service/auth';
import type { Actor } from '@/modules/roleplay/service/context';

/** Every roleplay page shows who you are acting as, so role-scoped views are never ambiguous. */
export async function withActor(): Promise<Actor | null> {
  try { return await requestActor(); } catch { return null; }
}

export function WhoAmI({ actor }: { actor: Actor }) {
  return <p className="small muted" aria-label="Current practice identity">
    Acting as <strong>{actor.display_name}</strong> · {actor.roles.join(', ') || 'no roles'} · tenant {actor.tenant_slug}
    {' · '}<Link href="/roleplay/demo">switch</Link>
  </p>;
}

export function SignInFirst() {
  return <main className="page"><div className="page-head"><h1>Practice coach</h1><p>Sign in as a candidate, or as the demo administrator, to use the practice coach.</p></div>
    <div className="btnrow"><Link className="btn btn-primary" href="/sign-in">Sign in</Link><Link className="btn" href="/demo">Demo administrator</Link></div></main>;
}

export function Denied({ actor, need }: { actor: Actor; need: string }) {
  return <main className="page"><div className="page-head"><h1>Not available</h1><p>This page needs the {need} role.</p></div><WhoAmI actor={actor} /></main>;
}
