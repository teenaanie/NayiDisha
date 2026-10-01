import { sql } from '@/lib/db';
import { compile } from '../config/compile';
import { loadScenarioPackage } from '../config/content';
import { actorFor, type Actor } from './context';
import { ensurePrompts, createDraft, submitDraft, publishDraft, validateBundleForTenant } from './registry';

/**
 * Synthetic tenants, teams and accounts, and the source scenario published
 * through the real draft → review → publish path. Idempotent: re-running it
 * changes nothing that exists. All people here are fictional.
 */

type Seat = { subject: string; name: string; roles: string[]; teams?: [string, 'member' | 'manager'][] };
const TENANTS: { slug: string; name: string; settings: Record<string, unknown>; teams: string[]; seats: Seat[]; scenarios: string[] }[] = [
  {
    slug: 'nayidisha', name: 'NayiDisha (demo)',
    settings: { author_reviewer_combined: false, daily_provider_call_budget: 5000, min_cohort: 5 },
    teams: ['North sales team', 'South sales team'],
    seats: [
      { subject: 'nd:admin:ADMIN-001', name: 'Demo administrator', roles: ['author', 'reviewer', 'manager', 'tenant_admin', 'learner'], teams: [['North sales team', 'manager'], ['South sales team', 'manager']] },
      { subject: 'nd:operations', name: 'Operations', roles: ['author', 'manager'] },
      { subject: 'synthetic:author.meera', name: 'Meera (author)', roles: ['author'] },
      { subject: 'synthetic:reviewer.rahul', name: 'Rahul (reviewer)', roles: ['reviewer'] },
      { subject: 'synthetic:manager.neha', name: 'Neha (manager, North)', roles: ['manager'], teams: [['North sales team', 'manager']] },
      { subject: 'synthetic:manager.sanjay', name: 'Sanjay (manager, South)', roles: ['manager'], teams: [['South sales team', 'manager']] },
      ...['asha', 'vikram', 'farah', 'dev', 'kiran'].map((n): Seat => ({ subject: `synthetic:learner.${n}`, name: `${n[0].toUpperCase()}${n.slice(1)} (learner, North)`, roles: ['learner'], teams: [['North sales team', 'member']] })),
      ...['leela', 'omar'].map((n): Seat => ({ subject: `synthetic:learner.${n}`, name: `${n[0].toUpperCase()}${n.slice(1)} (learner, South)`, roles: ['learner'], teams: [['South sales team', 'member']] })),
    ],
    scenarios: ['EDU_DISCOVERY_001'],
  },
  {
    slug: 'acme-training', name: 'Acme Training (synthetic second tenant)',
    settings: { author_reviewer_combined: true, min_cohort: 5 },
    teams: ['Acme team'],
    seats: [
      { subject: 'synthetic:acme.admin', name: 'Acme admin', roles: ['author', 'reviewer', 'manager', 'tenant_admin'], teams: [['Acme team', 'manager']] },
      { subject: 'synthetic:acme.learner', name: 'Acme learner', roles: ['learner'], teams: [['Acme team', 'member']] },
    ],
    scenarios: ['EDU_DISCOVERY_001'],
  },
];

export async function seedRoleplay(log: (s: string) => void = console.log) {
  await ensurePrompts();
  for (const t of TENANTS) {
    const [tenant] = await sql<{ id: string }[]>`
      INSERT INTO rp.tenant (slug, name, settings) VALUES (${t.slug}, ${t.name}, ${sql.json(t.settings as never)})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const teamIds = new Map<string, string>();
    for (const name of t.teams) {
      const [team] = await sql<{ id: string }[]>`INSERT INTO rp.team (tenant_id, name) VALUES (${tenant.id}, ${name}) ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      teamIds.set(name, team.id);
    }
    for (const seat of t.seats) {
      const [u] = await sql<{ id: string }[]>`
        INSERT INTO rp.app_user (tenant_id, subject, display_name, synthetic) VALUES (${tenant.id}, ${seat.subject}, ${seat.name}, TRUE)
        ON CONFLICT (tenant_id, subject) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
      for (const role of seat.roles) await sql`INSERT INTO rp.membership (tenant_id, user_id, role) VALUES (${tenant.id}, ${u.id}, ${role}) ON CONFLICT DO NOTHING`;
      for (const [team, role] of seat.teams ?? []) await sql`INSERT INTO rp.team_membership (tenant_id, team_id, user_id, role) VALUES (${tenant.id}, ${teamIds.get(team)!}, ${u.id}, ${role}) ON CONFLICT DO NOTHING`;
    }
    for (const id of t.scenarios) {
      const pkg = loadScenarioPackage(id);
      const b = pkg.bundle as { scenario: { id: string; version: string } };
      const [exists] = await sql<{ bundle_hash: string }[]>`SELECT bundle_hash FROM rp.scenario_version WHERE tenant_id = ${tenant.id} AND scenario_id = ${b.scenario.id} AND version = ${b.scenario.version}`;
      if (exists) {
        // Same version, different content would otherwise be skipped silently and the new content never published.
        const digest = compile(pkg.bundle).digest;
        if (digest && digest !== exists.bundle_hash) throw new Error(`${t.slug}: ${id} ${b.scenario.version} is already published with different content (bundle ${exists.bundle_hash.slice(0, 12)}, disk ${digest.slice(0, 12)}). Bump scenario.version; published versions are immutable.`);
        log(`  ${t.slug}: ${id} ${b.scenario.version} already published`); continue;
      }
      const v = await validateBundleForTenant(tenant.id, pkg.bundle);
      if (!v.ok) throw new Error(`${id} does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
      const author = await seatActor(tenant.id, t.slug === 'nayidisha' ? 'synthetic:author.meera' : 'synthetic:acme.admin');
      const reviewer = await seatActor(tenant.id, t.slug === 'nayidisha' ? 'synthetic:reviewer.rahul' : 'synthetic:acme.admin');
      await sql`UPDATE rp.scenario_draft SET status = 'discarded' WHERE tenant_id = ${tenant.id} AND scenario_id = ${b.scenario.id} AND status IN ('draft','in_review')`;
      const d = await createDraft(author, pkg.bundle);
      await submitDraft(author, d.draft_id, d.revision);
      const p = await publishDraft(reviewer, d.draft_id, d.revision, `Seeded from content/scenarios/${id} (source sha256 ${pkg.sourceSha256.slice(0, 12)}, ${pkg.overlayOps} overlay ops).`, true);
      log(`  ${t.slug}: published ${id} ${p.version} (bundle ${p.bundle_hash!.slice(0, 12)})`);
    }
  }
}

async function seatActor(tenantId: string, subject: string): Promise<Actor> {
  const a = await actorFor(tenantId, subject);
  if (!a) throw new Error(`Seed account ${subject} missing.`);
  return a;
}
