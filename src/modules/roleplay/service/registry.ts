import { sql } from '@/lib/db';
import { languagesOf, localized } from '../runtime/language';
import { compile, digestOf, sha256, parseStrictJson, type Issue } from '../config/compile';
import { loadPrompt } from '../config/content';
import { runtimeOf } from '../config/runtime-extension';
import type { ScenarioBundle } from '../contracts/types';
import { ENGINE_VERSION } from '../runtime/engine';
import { EVALUATOR_VERSION } from '../evaluation/assess';
import { ApiError, audit, conflict, forbidden, notFound, requireRole, type Actor } from './context';

/**
 * Configuration registry (spec §8, §21, §22).
 *
 * Lifecycle: draft → in_review → published → retired, with in_review → draft
 * on rejection. Published versions are immutable (a database trigger enforces
 * it); editing one opens a new draft. Publication pins the exact prompt
 * template digests, so a session started today replays tomorrow with the same
 * instructions even if a template is later retired.
 */

export const PROMPT_IDS = ['roleplay_v1', 'evaluator_v1', 'coach_v1', 'evaluator_v2', 'coach_v2', 'roleplay_v2', 'roleplay_v3', 'evaluator_v3'];

export async function ensurePrompts() {
  for (const id of PROMPT_IDS) {
    const content = loadPrompt(id);
    const kind = id.startsWith('roleplay') ? 'roleplay' : id.startsWith('evaluator') ? 'evaluator' : 'coach';
    const digest = sha256(content);
    const [row] = await sql<{ digest: string }[]>`SELECT digest FROM rp.prompt_version WHERE id = ${id}`;
    if (row && row.digest !== digest) throw new Error(`Prompt ${id} changed on disk; approved templates are immutable. Add ${id.replace(/\d+$/, (n) => String(Number(n) + 1))} instead.`);
    if (!row) await sql`INSERT INTO rp.prompt_version (id, kind, content, digest, status, approved_by) VALUES (${id}, ${kind}, ${content}, ${digest}, 'approved', 'system:seed')`;
  }
}
export async function approvedPromptIds() {
  return (await sql<{ id: string }[]>`SELECT id FROM rp.prompt_version WHERE status = 'approved'`).map((r) => r.id);
}
export async function promptContent(id: string) {
  const [row] = await sql<{ content: string; digest: string }[]>`SELECT content, digest FROM rp.prompt_version WHERE id = ${id}`;
  if (!row) throw new ApiError(500, 'CONFIG_INTEGRITY', `Pinned prompt ${id} is missing.`);
  return row;
}

const semver = (v: string) => v.split('.').map(Number);
export function semverGreater(a: string, b: string) {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// ---- drafts -------------------------------------------------------------------

function parseBundleInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try { return parseStrictJson(input); } catch (e) { throw new ApiError(400, 'INVALID_JSON', (e as Error).message); }
  }
  return input;
}

export async function createDraft(actor: Actor, input: unknown, opts: { basedOn?: string } = {}) {
  requireRole(actor, 'author');
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const bundle = parseBundleInput(input) as Partial<ScenarioBundle>;
  const scenarioId = bundle?.scenario?.id;
  if (typeof scenarioId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(scenarioId)) throw new ApiError(422, 'SCENARIO_ID_REQUIRED', 'The bundle needs scenario.id before it can be saved as a draft.');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new ApiError(422, 'BUNDLE_TOO_LARGE', 'Bundles are limited to 1 MB.');
  try {
    const [d] = await sql<{ id: string; revision: number }[]>`
      INSERT INTO rp.scenario_draft (tenant_id, scenario_id, status, bundle, import_digest, base_version, created_by)
      VALUES (${actor.tenant_id}, ${scenarioId}, 'draft', ${sql.json(bundle as never)}, ${sha256(raw)}, ${opts.basedOn ?? null}, ${actor.user_id})
      RETURNING id, revision`;
    await audit(actor, 'draft.created', 'scenario_draft', d.id, { scenario_id: scenarioId, import_digest: sha256(raw) }, { after: digestOf(bundle) });
    return { draft_id: d.id, revision: d.revision, scenario_id: scenarioId };
  } catch (e) {
    if (/uq_open_draft/.test((e as Error).message)) throw conflict('DRAFT_EXISTS', `An open draft already exists for ${scenarioId}. Edit it, or discard it first.`);
    throw e;
  }
}

/** Editing a published version opens a new draft seeded from it. */
export async function draftFromVersion(actor: Actor, versionId: string) {
  requireRole(actor, 'author');
  const [v] = await sql<{ bundle: ScenarioBundle; version: string }[]>`SELECT bundle, version FROM rp.scenario_version WHERE id = ${versionId} AND tenant_id = ${actor.tenant_id} AND NOT preview_only`;
  if (!v) throw notFound('Scenario version');
  return createDraft(actor, v.bundle, { basedOn: v.version });
}

async function loadDraft(actor: Actor, draftId: string, lock = false, conn = sql) {
  const rows = lock
    ? await conn`SELECT * FROM rp.scenario_draft WHERE id = ${draftId} AND tenant_id = ${actor.tenant_id} FOR UPDATE`
    : await conn`SELECT * FROM rp.scenario_draft WHERE id = ${draftId} AND tenant_id = ${actor.tenant_id}`;
  if (!rows[0]) throw notFound('Draft');
  return rows[0];
}

export async function updateDraft(actor: Actor, draftId: string, input: unknown, expectedRevision: number) {
  requireRole(actor, 'author');
  const bundle = parseBundleInput(input) as Partial<ScenarioBundle>;
  return sql.begin(async (tx) => {
    const d = await loadDraft(actor, draftId, true, tx as never);
    if (d.status !== 'draft') throw conflict('DRAFT_NOT_EDITABLE', `This draft is ${d.status}; only drafts can be edited.`);
    if (d.revision !== expectedRevision) throw conflict('STALE_REVISION', 'The draft changed since you loaded it.', { current_revision: d.revision });
    if (bundle?.scenario?.id !== d.scenario_id) throw new ApiError(422, 'SCENARIO_ID_CHANGED', 'scenario.id cannot change within a draft.');
    const [u] = await tx`UPDATE rp.scenario_draft SET bundle = ${tx.json(bundle as never)}, revision = revision + 1, updated_at = now() WHERE id = ${draftId} RETURNING revision`;
    await audit(actor, 'draft.updated', 'scenario_draft', draftId, { revision: u.revision }, { before: digestOf(d.bundle), after: digestOf(bundle) }, tx as never);
    return { draft_id: draftId, revision: u.revision as number };
  });
}

export interface ValidationReport { ok: boolean; errors: Issue[]; warnings: Issue[]; digest: string | null; diff: SemanticDiff | null; publication_notes: string[] }

export async function validateDraft(actor: Actor, draftId: string): Promise<ValidationReport> {
  requireRole(actor, 'author', 'reviewer');
  const d = await loadDraft(actor, draftId);
  return validateBundleForTenant(actor.tenant_id, d.bundle);
}

export async function validateBundleForTenant(tenantId: string, bundle: unknown): Promise<ValidationReport> {
  const r = compile(bundle, { availablePromptIds: await approvedPromptIds() });
  const errors = [...r.errors];
  let diff: SemanticDiff | null = null;
  const notes: string[] = [];
  const b = bundle as ScenarioBundle;
  if (r.ok) {
    const [latest] = await sql<{ version: string; bundle: ScenarioBundle }[]>`
      SELECT version, bundle FROM rp.scenario_version WHERE tenant_id = ${tenantId} AND scenario_id = ${b.scenario.id} AND NOT preview_only ORDER BY published_at DESC LIMIT 1`;
    const [exists] = await sql`SELECT 1 FROM rp.scenario_version WHERE tenant_id = ${tenantId} AND scenario_id = ${b.scenario.id} AND version = ${b.scenario.version} AND NOT preview_only`;
    if (exists) errors.push({ path: '/scenario/version', message: `Version ${b.scenario.version} is already published; published content is immutable. Bump the version.` });
    if (latest && !exists) {
      diff = semanticDiff(latest.bundle, b);
      if (!semverGreater(b.scenario.version, latest.version)) errors.push({ path: '/scenario/version', message: `Version must be greater than the latest published ${latest.version}.` });
      else if (diff.required_bump === 'major' && semver(b.scenario.version)[0] <= semver(latest.version)[0]) errors.push({ path: '/scenario/version', message: `Scoring meaning changed (${diff.scoring_changes.join('; ')}); this needs a major version.` });
    }
  }
  // Reviewer acknowledgements the spec requires before publication (§21).
  if (r.ok) {
    const recAnchors = b.rubric.dimensions.flatMap((d) => d.anchors.filter((a) => a.basis === 'recommendation').map((a) => `${d.id}:${a.score}`));
    if (recAnchors.length) notes.push(`${recAnchors.length} rubric anchors are recommendations, not source (${recAnchors.slice(0, 6).join(', ')}${recAnchors.length > 6 ? ', …' : ''}). Reviewer must acknowledge.`);
    const kp = (b.extensions as Record<string, unknown> | undefined)?.knowledge_pack;
    if (!kp) notes.push('No product-policy knowledge pack: factual product accuracy will be marked not assessed.');
    const unknown = b.facts.filter((f) => f.knowledge === 'unknown').map((f) => f.id);
    if (unknown.length) notes.push(`Unknown facts answered with the configured unknown reply: ${unknown.join(', ')}.`);
    if (!runtimeOf(b).discovery_gate) notes.push('No discovery gate configured: early-pitch detection cannot depend on discovery state.');
  }
  return { ok: errors.length === 0, errors, warnings: r.warnings, digest: r.digest, diff, publication_notes: notes };
}

export async function submitDraft(actor: Actor, draftId: string, expectedRevision: number) {
  requireRole(actor, 'author');
  const v = await validateDraft(actor, draftId);
  if (!v.ok) throw new ApiError(422, 'VALIDATION_FAILED', 'Fix validation errors before submitting for review.', false, { errors: v.errors });
  return sql.begin(async (tx) => {
    const d = await loadDraft(actor, draftId, true, tx as never);
    if (d.status !== 'draft') throw conflict('DRAFT_NOT_EDITABLE', `This draft is ${d.status}.`);
    if (d.revision !== expectedRevision) throw conflict('STALE_REVISION', 'The draft changed since you validated it.', { current_revision: d.revision });
    await tx`UPDATE rp.scenario_draft SET status = 'in_review', submitted_by = ${actor.user_id}, submitted_at = now(), updated_at = now() WHERE id = ${draftId}`;
    await audit(actor, 'draft.submitted', 'scenario_draft', draftId, { revision: d.revision }, { after: digestOf(d.bundle) }, tx as never);
    return { draft_id: draftId, status: 'in_review' };
  });
}

export async function rejectDraft(actor: Actor, draftId: string, note: string) {
  requireRole(actor, 'reviewer');
  return sql.begin(async (tx) => {
    const d = await loadDraft(actor, draftId, true, tx as never);
    if (d.status !== 'in_review') throw conflict('NOT_IN_REVIEW', 'Only drafts in review can be rejected.');
    await tx`UPDATE rp.scenario_draft SET status = 'draft', review_note = ${note}, updated_at = now() WHERE id = ${draftId}`;
    await audit(actor, 'draft.rejected', 'scenario_draft', draftId, { note }, {}, tx as never);
    return { draft_id: draftId, status: 'draft' };
  });
}

async function tenantSettings(tenantId: string) {
  const [t] = await sql<{ settings: Record<string, unknown> }[]>`SELECT settings FROM rp.tenant WHERE id = ${tenantId}`;
  return t?.settings ?? {};
}

export async function publishDraft(actor: Actor, draftId: string, expectedRevision: number, reviewNote: string, acknowledged: boolean) {
  requireRole(actor, 'reviewer');
  if (!acknowledged) throw new ApiError(422, 'ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge the publication notes (recommended anchors, knowledge-pack status) before publishing.');
  const d0 = await loadDraft(actor, draftId);
  const settings = await tenantSettings(actor.tenant_id);
  if (d0.submitted_by === actor.user_id && !settings.author_reviewer_combined) throw forbidden('The person who submitted a draft cannot also publish it in this tenant.');
  const v = await validateBundleForTenant(actor.tenant_id, d0.bundle);
  if (!v.ok) throw new ApiError(422, 'VALIDATION_FAILED', 'This draft no longer validates.', false, { errors: v.errors });
  const b = d0.bundle as ScenarioBundle;
  const prompts = Object.fromEntries(await Promise.all(Object.entries(b.prompts).map(async ([k, id]) => [k, { id, digest: (await promptContent(id)).digest }])));
  return sql.begin(async (tx) => {
    const d = await loadDraft(actor, draftId, true, tx as never);
    if (d.status !== 'in_review') throw conflict('NOT_IN_REVIEW', 'Submit the draft for review first.');
    if (d.revision !== expectedRevision) throw conflict('STALE_REVISION', 'The draft changed since review started.', { current_revision: d.revision });
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO rp.scenario_version (tenant_id, scenario_id, version, status, bundle, bundle_hash, rubric_version, scoring_version, persona_version, risk_version,
        prompt_versions, engine_version, draft_id, published_by, reviewed_by, review_note)
      VALUES (${actor.tenant_id}, ${b.scenario.id}, ${b.scenario.version}, 'published', ${tx.json(b as never)}, ${v.digest}, ${`${b.rubric.id}@${b.rubric.version}`},
        ${`${b.scoring.id}@${b.scoring.version}`}, ${`${b.persona.id}@${b.persona.version}`}, ${`${b.risk_policy.id}@${b.risk_policy.version}`},
        ${tx.json(prompts as never)}, ${`${ENGINE_VERSION}|${EVALUATOR_VERSION}`}, ${draftId}, ${d.submitted_by ?? actor.user_id}, ${actor.user_id}, ${reviewNote})
      RETURNING id`;
    await tx`UPDATE rp.scenario_draft SET status = 'published', updated_at = now() WHERE id = ${draftId}`;
    await audit(actor, 'scenario.published', 'scenario_version', row.id, { scenario_id: b.scenario.id, version: b.scenario.version, acknowledged, notes: v.publication_notes, diff: v.diff }, { after: v.digest }, tx as never);
    return { scenario_version_id: row.id, scenario_id: b.scenario.id, version: b.scenario.version, bundle_hash: v.digest };
  });
}

export async function retireVersion(actor: Actor, scenarioId: string, version: string, reason: string) {
  requireRole(actor, 'reviewer');
  if (!reason?.trim()) throw new ApiError(422, 'REASON_REQUIRED', 'Give a reason for retiring this version.');
  const [row] = await sql<{ id: string }[]>`
    UPDATE rp.scenario_version SET status = 'retired', retired_at = now(), retired_reason = ${reason}
     WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${scenarioId} AND version = ${version} AND status = 'published' RETURNING id`;
  if (!row) throw notFound('Published version');
  await audit(actor, 'scenario.retired', 'scenario_version', row.id, { scenario_id: scenarioId, version, reason });
  return { scenario_version_id: row.id, status: 'retired' };
}

/**
 * A preview pins the draft as a test-only version so a real session can run
 * against it. Preview sessions are labelled and excluded from analytics.
 */
export async function createPreviewVersion(actor: Actor, draftId: string) {
  requireRole(actor, 'author', 'reviewer');
  const d = await loadDraft(actor, draftId);
  const r = compile(d.bundle, { availablePromptIds: await approvedPromptIds() });
  if (!r.ok) throw new ApiError(422, 'VALIDATION_FAILED', 'Only a valid draft can be previewed.', false, { errors: r.errors });
  const b = r.bundle!;
  const prompts = Object.fromEntries(await Promise.all(Object.entries(b.prompts).map(async ([k, id]) => [k, { id, digest: (await promptContent(id)).digest }])));
  const previewVersion = `${b.scenario.version}+preview.${d.revision}.${r.digest!.slice(0, 8)}`;
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${b.scenario.id} AND version = ${previewVersion}`;
  if (existing) return { scenario_version_id: existing.id, version: previewVersion };
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO rp.scenario_version (tenant_id, scenario_id, version, status, bundle, bundle_hash, rubric_version, scoring_version, persona_version, risk_version,
      prompt_versions, engine_version, preview_only, draft_id, published_by, reviewed_by, review_note)
    VALUES (${actor.tenant_id}, ${b.scenario.id}, ${previewVersion}, 'published', ${sql.json(b as never)}, ${r.digest}, ${`${b.rubric.id}@${b.rubric.version}`},
      ${`${b.scoring.id}@${b.scoring.version}`}, ${`${b.persona.id}@${b.persona.version}`}, ${`${b.risk_policy.id}@${b.risk_policy.version}`},
      ${sql.json(prompts as never)}, ${`${ENGINE_VERSION}|${EVALUATOR_VERSION}`}, TRUE, ${draftId}, ${actor.user_id}, ${actor.user_id}, 'preview')
    RETURNING id`;
  await audit(actor, 'scenario.preview_created', 'scenario_version', row.id, { draft_id: draftId, version: previewVersion });
  return { scenario_version_id: row.id, version: previewVersion };
}

// ---- reads ----------------------------------------------------------------------

export async function listDrafts(actor: Actor) {
  requireRole(actor, 'author', 'reviewer');
  return sql`SELECT id, scenario_id, revision, status, base_version, created_by, submitted_by, submitted_at, review_note, updated_at,
                    bundle->'scenario'->>'version' AS version, bundle->'scenario'->>'title' AS title
               FROM rp.scenario_draft WHERE tenant_id = ${actor.tenant_id} AND status IN ('draft','in_review') ORDER BY updated_at DESC`;
}
export async function getDraft(actor: Actor, draftId: string) {
  requireRole(actor, 'author', 'reviewer');
  return loadDraft(actor, draftId);
}
export async function listVersions(actor: Actor) {
  requireRole(actor, 'author', 'reviewer', 'manager');
  return sql`SELECT id, scenario_id, version, status, bundle_hash, rubric_version, scoring_version, published_at, retired_at, retired_reason,
                    bundle->'scenario'->>'title' AS title
               FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND NOT preview_only ORDER BY scenario_id, published_at DESC`;
}
export async function exportVersion(actor: Actor, versionId: string) {
  requireRole(actor, 'author', 'reviewer');
  const [v] = await sql<{ bundle: ScenarioBundle; bundle_hash: string }[]>`SELECT bundle, bundle_hash FROM rp.scenario_version WHERE id = ${versionId} AND tenant_id = ${actor.tenant_id}`;
  if (!v) throw notFound('Scenario version');
  return v;
}

/** Learner-facing catalogue: public summaries of published, non-preview scenarios only. */
export async function publicScenarios(actor: Actor, filter: { product?: string; skill?: string } = {}) {
  requireRole(actor, 'learner');
  const rows = await sql<{ id: string; scenario_id: string; version: string; bundle: ScenarioBundle }[]>`
    SELECT DISTINCT ON (scenario_id) id, scenario_id, version, bundle FROM rp.scenario_version
     WHERE tenant_id = ${actor.tenant_id} AND status = 'published' AND NOT preview_only
     ORDER BY scenario_id, published_at DESC`;
  return rows.map((r) => publicSummary(r.id, r.bundle)).filter((s) => (!filter.product || s.product === filter.product) && (!filter.skill || s.skill === filter.skill));
}

export function publicSummary(versionId: string, b: ScenarioBundle) {
  return {
    scenario_version_id: versionId, scenario_id: b.scenario.id, version: b.scenario.version, title: b.scenario.title,
    product: b.scenario.product, skill: b.scenario.skill, difficulty: b.scenario.difficulty,
    learner_role: b.scenario.learner_role, target_minutes: b.scenario.target_minutes,
  };
}

/** The public brief: everything a learner may see before practice, nothing more (FR02). */
export function publicBrief(versionId: string, b: ScenarioBundle) {
  return {
    ...publicSummary(versionId, b),
    learner_brief: b.scenario.learner_brief,
    // Conversation languages on offer, each with the brief in that language (drafts are labelled).
    languages: languagesOf(b).map((l) => ({ ...l, learner_brief: localized(b, l.id).learner_brief })),
    success_criteria: b.scenario.success_criteria,
    customer: { name: b.persona.name, role: b.persona.role },
    // Practice reminders: the scenario's own, else its target range (e.g. 12 and 15 minutes).
    reminder_minutes: runtimeOf(b).reminder_minutes ?? [b.scenario.target_minutes.min, b.scenario.target_minutes.max],
    retry: { full_enabled: b.retry.full_enabled, focused_enabled: b.retry.focused_enabled },
  };
}

export async function getBrief(actor: Actor, scenarioId: string, version?: string) {
  requireRole(actor, 'learner');
  const rows = version
    ? await sql<{ id: string; bundle: ScenarioBundle }[]>`SELECT id, bundle FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${scenarioId} AND version = ${version} AND status = 'published' AND NOT preview_only`
    : await sql<{ id: string; bundle: ScenarioBundle }[]>`SELECT id, bundle FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${scenarioId} AND status = 'published' AND NOT preview_only ORDER BY published_at DESC LIMIT 1`;
  if (!rows[0]) throw notFound('Scenario');
  return publicBrief(rows[0].id, rows[0].bundle);
}

// ---- semantic diff (spec §21) --------------------------------------------------

export interface SemanticDiff {
  facts_changed: string[]; facts_added: string[]; facts_removed: string[];
  disclosure_changed: string[]; rubric_changes: string[]; scoring_changes: string[]; risk_changes: string[];
  required_bump: 'major' | 'minor' | 'patch' | 'none';
}
export function semanticDiff(a: ScenarioBundle, b: ScenarioBundle): SemanticDiff {
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const cmpSets = <T extends { id: string }>(xs: T[], ys: T[]) => {
    const [ma, mb] = [byId(xs), byId(ys)];
    return {
      added: [...mb.keys()].filter((k) => !ma.has(k)), removed: [...ma.keys()].filter((k) => !mb.has(k)),
      changed: [...mb.keys()].filter((k) => ma.has(k) && digestOf(ma.get(k)) !== digestOf(mb.get(k))),
    };
  };
  const f = cmpSets(a.facts, b.facts);
  const rules = cmpSets(a.conversation.rules, b.conversation.rules);
  const dims = cmpSets(a.rubric.dimensions, b.rubric.dimensions);
  const checks = cmpSets(a.rubric.checks, b.rubric.checks);
  const risks = cmpSets(a.risk_policy.rules, b.risk_policy.rules);
  const scoring: string[] = [];
  if (a.scoring.mode !== b.scoring.mode) scoring.push(`mode ${a.scoring.mode} → ${b.scoring.mode}`);
  if (digestOf(a.scoring.bands) !== digestOf(b.scoring.bands)) scoring.push('bands changed');
  if (digestOf(a.scoring.weights) !== digestOf(b.scoring.weights)) scoring.push('weights changed');
  if (a.scoring.risk_effect !== b.scoring.risk_effect || digestOf(a.scoring.risk_effect_parameters) !== digestOf(b.scoring.risk_effect_parameters)) scoring.push('risk effect changed');
  if (dims.added.length || dims.removed.length) scoring.push(`dimensions ${[...dims.added.map((x) => '+' + x), ...dims.removed.map((x) => '−' + x)].join(' ')}`);
  const anchorChanges = dims.changed.filter((id) => digestOf(a.rubric.dimensions.find((d) => d.id === id)!.anchors) !== digestOf(b.rubric.dimensions.find((d) => d.id === id)!.anchors) || a.rubric.dimensions.find((d) => d.id === id)!.max_score !== b.rubric.dimensions.find((d) => d.id === id)!.max_score);
  if (anchorChanges.length) scoring.push(`anchors or ranges changed: ${anchorChanges.join(', ')}`);
  const meaningful = f.added.length + f.removed.length + f.changed.length + rules.added.length + rules.removed.length + rules.changed.length + checks.added.length + checks.removed.length + checks.changed.length + risks.added.length + risks.removed.length + risks.changed.length;
  const anyChange = digestOf(a) !== digestOf(b);
  return {
    facts_changed: f.changed, facts_added: f.added, facts_removed: f.removed,
    disclosure_changed: [...rules.added.map((x) => '+' + x), ...rules.removed.map((x) => '−' + x), ...rules.changed],
    rubric_changes: [...dims.changed.map((x) => `dimension ${x}`), ...checks.added.map((x) => `+check ${x}`), ...checks.removed.map((x) => `−check ${x}`), ...checks.changed.map((x) => `check ${x}`)],
    scoring_changes: scoring,
    risk_changes: [...risks.added.map((x) => '+' + x), ...risks.removed.map((x) => '−' + x), ...risks.changed],
    required_bump: scoring.length ? 'major' : meaningful ? 'minor' : anyChange ? 'patch' : 'none',
  };
}
