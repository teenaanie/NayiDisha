import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { identity } from '@/lib/auth';
import { actorFor, type Actor } from './context';

/**
 * Maps the app's signed-cookie identity onto a roleplay user.
 *
 *   CANDIDATE  → a learner in the default tenant, provisioned on first use.
 *   ADMIN      → the demo administrator (author, reviewer, manager, tenant admin),
 *                or, in demo mode, any seeded synthetic account chosen on
 *                /roleplay/demo (cookie `rp_act_as`, HMAC-signed).
 *   OPERATIONS → the operations user (author, manager).
 *
 * This is the demo's authentication. Production replaces `identity()` with
 * SSO/OIDC; everything downstream uses only the resolved Actor (spec §23).
 */

export const DEFAULT_TENANT = 'nayidisha';
const secret = () => process.env.DEMO_SESSION_SECRET || process.env.DEMO_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'local-demo-only-secret' : '');
const sign = (v: string) => createHmac('sha256', secret()).update('rp_act_as:' + v).digest('base64url');
export const actAsCookie = (tenantSlug: string, subject: string) => { const v = `${tenantSlug}|${subject}`; return `${Buffer.from(v).toString('base64url')}.${sign(v)}`; };

function readActAs(raw: string | undefined): { tenant: string; subject: string } | null {
  if (!raw) return null;
  const [b, s] = raw.split('.');
  try {
    const v = Buffer.from(b, 'base64url').toString();
    const expected = sign(v);
    if (!s || s.length !== expected.length || !timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    const [tenant, subject] = v.split('|');
    return { tenant, subject };
  } catch { return null; }
}

async function tenantId(slug: string) {
  const [t] = await sql<{ id: string }[]>`SELECT id FROM rp.tenant WHERE slug = ${slug}`;
  return t?.id ?? null;
}

async function provisionLearner(tid: string, subject: string, name: string) {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO rp.app_user (tenant_id, subject, display_name) VALUES (${tid}, ${subject}, ${name})
    ON CONFLICT (tenant_id, subject) DO UPDATE SET display_name = rp.app_user.display_name RETURNING id`;
  await sql`INSERT INTO rp.membership (tenant_id, user_id, role) VALUES (${tid}, ${u.id}, 'learner') ON CONFLICT DO NOTHING`;
}

export async function requestActor(): Promise<Actor | null> {
  const who = await identity();
  if (!who) return null;
  const requestId = randomUUID();
  const tid = await tenantId(DEFAULT_TENANT);
  if (!tid) return null;   // platform not seeded
  if (who.role === 'ADMIN') {
    const act = readActAs((await cookies()).get('rp_act_as')?.value);
    if (act && process.env.DEMO_MODE !== 'false') {
      const t = await tenantId(act.tenant);
      if (t) { const a = await actorFor(t, act.subject, requestId); if (a) return a; }
    }
    return actorFor(tid, `nd:admin:${who.id}`, requestId);
  }
  if (who.role === 'OPERATIONS') return actorFor(tid, 'nd:operations', requestId);
  if (who.role === 'CANDIDATE') {
    const subject = `nd:candidate:${who.id}`;
    let a = await actorFor(tid, subject, requestId);
    if (!a) {
      const [c] = await sql<{ name: string | null }[]>`SELECT name FROM app.candidate WHERE id = ${who.id}`;
      await provisionLearner(tid, subject, c?.name ?? who.id);
      a = await actorFor(tid, subject, requestId);
    }
    return a;
  }
  return null;
}

/** For the demo switcher: every seeded synthetic account. */
export async function syntheticAccounts() {
  return sql<{ tenant: string; subject: string; display_name: string; roles: string[] }[]>`
    SELECT t.slug AS tenant, u.subject, u.display_name, COALESCE(array_agg(m.role ORDER BY m.role) FILTER (WHERE m.role IS NOT NULL), '{}') AS roles
      FROM rp.app_user u JOIN rp.tenant t ON t.id = u.tenant_id LEFT JOIN rp.membership m ON m.user_id = u.id
     WHERE u.synthetic GROUP BY t.slug, u.subject, u.display_name ORDER BY t.slug, u.subject`;
}
