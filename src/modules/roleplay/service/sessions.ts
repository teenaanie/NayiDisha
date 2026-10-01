import { sql } from '@/lib/db';
import { bcp47, isLanguage, languagesOf, localized, type Language } from '../runtime/language';
import { canonicalJson, sha256 } from '../config/compile';
import type { ScenarioBundle, TranscriptTurn } from '../contracts/types';
import { respond, ENGINE_VERSION } from '../runtime/engine';
import { openingFactIds } from '../runtime/disclosure';
import { CLASSIFIER_VERSION } from '../runtime/intents';
import { ApiError, audit, conflict, forbidden, metric, notFound, requireRole, type Actor } from './context';
import { LIMITS, rateLimit, spendProviderBudget } from './guards';
import { enqueue, registerHandler, PermanentJobError, type Job } from './jobs';
import { promptContent, publicBrief } from './registry';

/**
 * Session orchestration (spec §5, §16, §19).
 *
 * A learner turn is committed durably before it is acknowledged; the customer
 * reply is produced by a job and committed atomically with its disclosure
 * events. One reply may be pending per session. Every command carries the
 * revision the client last saw; a stale one is a 409 with the current public
 * state, never a silent reorder.
 */

type Tx = typeof sql;
export interface SessionRow {
  id: string; tenant_id: string; learner_id: string; scenario_version_id: string; scenario_id: string; scenario_version: string;
  bundle_hash: string; rubric_version: string; scoring_version: string; prompt_versions: Record<string, { id: string; digest: string }>;
  state: string; revision: number; parent_session_id: string | null; retry_scope: RetryScope | null; is_preview: boolean;
  started_at: Date; last_activity_at: Date; completed_at: Date | null; learner_turn_count: number; transcript_hash: string | null; current_run_id: string | null;
  /** Conversation language (migration 017); retries inherit it. */
  language: Language;
}
export interface RetryScope { mode: 'full' | 'focused'; plan_id: string; parent_run_id: string; checkpoint_sequence: number | null; target_check_ids: string[]; comparable: boolean }

export async function loadBundle(tenantId: string, versionId: string, expectedHash?: string): Promise<ScenarioBundle> {
  const [v] = await sql<{ bundle: ScenarioBundle; bundle_hash: string }[]>`SELECT bundle, bundle_hash FROM rp.scenario_version WHERE id = ${versionId} AND tenant_id = ${tenantId}`;
  // A missing or altered pinned version is an integrity incident; never substitute "latest" (spec §24).
  if (!v) throw new ApiError(500, 'CONFIG_INTEGRITY', 'The configuration this session is pinned to is missing.');
  if (expectedHash && v.bundle_hash !== expectedHash) throw new ApiError(500, 'CONFIG_INTEGRITY', 'The pinned configuration does not match its recorded digest.');
  return v.bundle;
}

export async function transcript(sessionId: string, conn: Tx = sql): Promise<(TranscriptTurn & { created_at: Date; input_mode: 'text' | 'voice' })[]> {
  return conn<(TranscriptTurn & { created_at: Date; input_mode: 'text' | 'voice' })[]>`
    SELECT t.id, t.sequence, t.speaker, t.text, t.origin, t.created_at, COALESCE(i.mode, 'text') AS input_mode
      FROM rp.turn t LEFT JOIN rp.turn_input i ON i.turn_id = t.id
     WHERE t.session_id = ${sessionId} ORDER BY t.sequence`;
}

/** Owner, a manager of the learner's team, or (for preview sessions) the author who started it. */
export async function loadSessionFor(actor: Actor, sessionId: string, access: 'owner' | 'owner_or_manager' = 'owner', conn: Tx = sql, lock = false): Promise<SessionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw notFound('Session');
  const rows = lock
    ? await conn<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${sessionId} AND tenant_id = ${actor.tenant_id} FOR UPDATE`
    : await conn<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${sessionId} AND tenant_id = ${actor.tenant_id}`;
  const s = rows[0];
  if (!s) throw notFound('Session');
  if (s.learner_id === actor.user_id) return s;
  if (access === 'owner_or_manager' && actor.roles.includes('manager') && actor.managed_team_ids.length && !s.is_preview) {
    const [m] = await conn`SELECT 1 FROM rp.team_membership WHERE user_id = ${s.learner_id} AND tenant_id = ${actor.tenant_id} AND role = 'member' AND team_id = ANY(${actor.managed_team_ids}) AND (valid_to IS NULL OR valid_to > now())`;
    if (m) return s;
  }
  if (access === 'owner_or_manager' && actor.roles.includes('reviewer')) return s; // reviewers see evidence for review; no team drill-down
  throw notFound('Session');   // 404, not 403: existence is not disclosed
}

export function publicSession(s: SessionRow, turns: { id: string; sequence: number; speaker: string; text: string; origin: string; created_at: Date; input_mode?: string }[], pending: { id: string; status: string } | null) {
  return {
    session_id: s.id, scenario_id: s.scenario_id, scenario_version: s.scenario_version, state: s.state, revision: s.revision, language: s.language ?? 'en',
    is_preview: s.is_preview, parent_session_id: s.parent_session_id,
    retry_scope: s.retry_scope ? { mode: s.retry_scope.mode, comparable: s.retry_scope.comparable, target_check_ids: s.retry_scope.target_check_ids } : null,
    started_at: s.started_at, completed_at: s.completed_at, learner_turn_count: s.learner_turn_count,
    transcript: turns.map((t) => ({ turn_id: t.id, sequence: t.sequence, speaker: t.speaker, text: t.text, origin: t.origin, created_at: t.created_at, input_mode: t.input_mode ?? 'text' })),
    pending_operation: pending,
    limits: LIMITS,
  };
}

async function pendingOp(sessionId: string, conn: Tx = sql) {
  const [op] = await conn<{ id: string; status: string }[]>`SELECT id, status FROM rp.operation WHERE session_id = ${sessionId} AND kind = 'customer_turn' AND status = 'pending'`;
  return op ?? null;
}

// ---- start --------------------------------------------------------------------

export interface StartInput { scenario_id: string; scenario_version?: string; preview_version_id?: string; language?: string }

export async function startSession(actor: Actor, input: StartInput, parent?: { session_id: string; scope: RetryScope; prefix?: TranscriptTurn[]; version_id: string; language?: Language }) {
  const preview = !!input.preview_version_id;
  if (preview) requireRole(actor, 'author', 'reviewer'); else requireRole(actor, 'learner');
  await rateLimit(actor, 'start');
  const [v] = parent
    ? await sql<{ id: string; bundle: ScenarioBundle; bundle_hash: string; version: string; status: string; rubric_version: string; scoring_version: string; prompt_versions: Record<string, { id: string; digest: string }>; engine_version: string; preview_only: boolean }[]>`
        SELECT * FROM rp.scenario_version WHERE id = ${parent.version_id} AND tenant_id = ${actor.tenant_id}`
    : preview
      ? await sql`SELECT * FROM rp.scenario_version WHERE id = ${input.preview_version_id!} AND tenant_id = ${actor.tenant_id} AND preview_only`
      : input.scenario_version
        ? await sql`SELECT * FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${input.scenario_id} AND version = ${input.scenario_version} AND NOT preview_only`
        : await sql`SELECT * FROM rp.scenario_version WHERE tenant_id = ${actor.tenant_id} AND scenario_id = ${input.scenario_id} AND status = 'published' AND NOT preview_only ORDER BY published_at DESC LIMIT 1` as never;
  if (!v) throw notFound('Scenario');
  // Retiring stops new starts; a retry of a pinned session may still use its version (spec §19).
  if (v.status !== 'published' && !parent) throw conflict('SCENARIO_RETIRED', 'This scenario version has been retired and cannot be started.');
  const b = v.bundle as ScenarioBundle;
  // A retry keeps the parent's language; otherwise the learner's choice, which the scenario must offer.
  const language: Language = parent?.language ?? (input.language === undefined ? 'en' : (isLanguage(input.language) && languagesOf(b).some((l) => l.id === input.language) ? input.language : (() => {
    throw new ApiError(422, 'LANGUAGE_UNAVAILABLE', `This scenario is available in ${languagesOf(b).map((l) => l.label).join(', ')}.`);
  })()));

  const started = await sql.begin(async (tx) => {
    const [s] = await tx<SessionRow[]>`
      INSERT INTO rp.session (tenant_id, learner_id, scenario_version_id, scenario_id, scenario_version, bundle_hash, rubric_version, scoring_version,
        prompt_versions, engine_version, state, revision, parent_session_id, retry_scope, is_preview, language)
      VALUES (${actor.tenant_id}, ${actor.user_id}, ${v.id}, ${b.scenario.id}, ${v.version}, ${v.bundle_hash}, ${v.rubric_version}, ${v.scoring_version},
        ${tx.json(v.prompt_versions as never)}, ${v.engine_version}, 'active', 0, ${parent?.session_id ?? null}, ${parent ? tx.json(parent.scope as never) : null}, ${preview || v.preview_only}, ${language})
      RETURNING *`;
    let seq = 0;
    let openingId: string;
    if (parent?.prefix?.length) {
      // Focused retry: the parent's prefix is context, cloned with new IDs and marked retry_prefix.
      const map = new Map<string, string>();
      for (const t of parent.prefix) {
        const [nt] = await tx<{ id: string }[]>`INSERT INTO rp.turn (tenant_id, session_id, sequence, speaker, text, origin) VALUES (${actor.tenant_id}, ${s.id}, ${seq++}, ${t.speaker}, ${t.text}, 'retry_prefix') RETURNING id`;
        map.set(t.id, nt.id);
      }
      openingId = map.get(parent.prefix[0].id)!;
      const events = await tx<{ fact_id: string; customer_turn_id: string; intent_id: string | null; confidence: string | null }[]>`
        SELECT fact_id, customer_turn_id, intent_id, confidence FROM rp.disclosure_event WHERE session_id = ${parent.session_id}`;
      for (const e of events) {
        const ct = map.get(e.customer_turn_id);
        if (!ct) continue;   // disclosed after the checkpoint: not carried over
        await tx`INSERT INTO rp.disclosure_event (tenant_id, session_id, fact_id, method, intent_id, confidence, customer_turn_id, classifier_version)
                 VALUES (${actor.tenant_id}, ${s.id}, ${e.fact_id}, 'retry_prefix', ${e.intent_id}, ${e.confidence}, ${ct}, ${CLASSIFIER_VERSION})`;
      }
      const analyses = await tx<{ turn_id: string; intents: unknown; low_confidence: boolean; classifier_version: string; plan: unknown }[]>`
        SELECT turn_id, intents, low_confidence, classifier_version, plan FROM rp.turn_analysis WHERE session_id = ${parent.session_id}`;
      for (const a of analyses) {
        const nt = map.get(a.turn_id);
        if (nt) await tx`INSERT INTO rp.turn_analysis (turn_id, tenant_id, session_id, intents, low_confidence, classifier_version, plan, generation)
                         VALUES (${nt}, ${actor.tenant_id}, ${s.id}, ${tx.json(a.intents as never)}, ${a.low_confidence}, ${a.classifier_version}, ${tx.json(a.plan as never)}, ${tx.json({ cloned_from: a.turn_id } as never)})`;
      }
    } else {
      // The exact configured opening is committed as turn 0 without a model call (spec §5 step 3).
      const [o] = await tx<{ id: string }[]>`INSERT INTO rp.turn (tenant_id, session_id, sequence, speaker, text, origin) VALUES (${actor.tenant_id}, ${s.id}, 0, 'customer', ${localized(b, language).opening_text}, 'opening') RETURNING id`;
      openingId = o.id; seq = 1;
      for (const f of openingFactIds(b)) {
        await tx`INSERT INTO rp.disclosure_event (tenant_id, session_id, fact_id, method, customer_turn_id, classifier_version) VALUES (${actor.tenant_id}, ${s.id}, ${f}, 'opening', ${o.id}, ${CLASSIFIER_VERSION})`;
      }
    }
    const learnerTurns = parent?.prefix?.filter((t) => t.speaker === 'learner').length ?? 0;
    const [u] = await tx<SessionRow[]>`UPDATE rp.session SET revision = ${seq}, learner_turn_count = ${learnerTurns} WHERE id = ${s.id} RETURNING *`;
    await audit(actor, parent ? 'session.retry_started' : 'session.started', 'session', s.id, { scenario_id: b.scenario.id, version: v.version, bundle_hash: v.bundle_hash, preview: s.is_preview, retry_mode: parent?.scope.mode ?? null }, {}, tx as never);
    return { session: publicSession(u, await transcript(s.id, tx as never), null), brief: publicBrief(v.id, b), opening_turn_id: openingId };
  });
  // Outside the transaction: metric() uses the pool, which a one-connection serverless pool cannot lend twice.
  await metric('session_started', 1, { scenario: b.scenario.id, preview: started.session.is_preview, retry: parent?.scope.mode ?? 'none' }, actor.tenant_id);
  return started;
}

// ---- read ---------------------------------------------------------------------

/** Sessions idle past the limit are abandoned on the next read or write (spec §7). */
async function expireIfIdle(s: SessionRow): Promise<SessionRow> {
  if (s.state !== 'active') return s;
  if (Date.now() - new Date(s.last_activity_at).getTime() < LIMITS.idle_expiry_minutes * 60000) return s;
  const [u] = await sql<SessionRow[]>`UPDATE rp.session SET state = 'abandoned', abandon_reason = 'idle_expiry', revision = revision + 1 WHERE id = ${s.id} AND state = 'active' RETURNING *`;
  if (u) await audit(null, 'session.idle_expired', 'session', s.id, {});
  return u ?? s;
}

export async function getSession(actor: Actor, sessionId: string) {
  let s = await loadSessionFor(actor, sessionId);
  s = await expireIfIdle(s);
  const { voiceCapabilities, hasVoiceConsent } = await import('./voice');
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  const lang = s.language ?? 'en';
  return { ...publicSession(s, await transcript(s.id), await pendingOp(s.id)), learner_brief: localized(bundle, lang).learner_brief, voice: { ...voiceCapabilities(bcp47(lang)), consent: await hasVoiceConsent(actor) } };
}

export async function listMySessions(actor: Actor) {
  return sql`
    SELECT s.id, s.scenario_id, s.scenario_version, s.state, s.started_at, s.completed_at, s.parent_session_id, s.retry_scope->>'mode' AS retry_mode,
           s.is_preview, r.score->>'raw_total' AS raw_total, r.score->>'raw_max' AS raw_max, r.score->>'band_label' AS band_label, r.score->>'mode' AS score_mode, r.score->>'final_percent' AS final_percent,
           r.score->>'final_percent' AS final_percent, r.status AS run_status, v.bundle->'scenario'->>'title' AS title
      FROM rp.session s JOIN rp.scenario_version v ON v.id = s.scenario_version_id
      LEFT JOIN rp.evaluation_run r ON r.id = s.current_run_id
     WHERE s.tenant_id = ${actor.tenant_id} AND s.learner_id = ${actor.user_id}
     ORDER BY s.started_at DESC LIMIT 100`;
}

// ---- turns ----------------------------------------------------------------------

export interface TurnInputBody { client_message_id: string; text: string; expected_revision: number; input?: unknown }

export async function submitTurn(actor: Actor, sessionId: string, body: TurnInputBody) {
  if (typeof body?.client_message_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(body.client_message_id)) throw new ApiError(400, 'BAD_CLIENT_MESSAGE_ID', 'client_message_id is required.');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new ApiError(400, 'EMPTY_MESSAGE', 'Type a message first.');
  if (body.text.length > LIMITS.max_message_chars) throw new ApiError(422, 'MESSAGE_TOO_LONG', `Messages are limited to ${LIMITS.max_message_chars} characters.`);
  if (!Number.isInteger(body.expected_revision)) throw new ApiError(400, 'REVISION_REQUIRED', 'expected_revision is required.');
  await rateLimit(actor, 'turn');
  // A spoken turn carries its provenance; the text is still what the learner confirmed.
  const { parseVoiceInput, hasVoiceConsent } = await import('./voice');
  const voice = parseVoiceInput(body.input);
  let voiceLanguage = 'en-IN';
  if (voice) {
    if (!(await hasVoiceConsent(actor))) throw new ApiError(403, 'VOICE_CONSENT_REQUIRED', 'Allow voice practice before sending a spoken message.');
    const pre = await loadSessionFor(actor, sessionId);
    voiceLanguage = bcp47(pre.language ?? 'en');
  }

  const result = await sql.begin(async (tx) => {
    let s = await loadSessionFor(actor, sessionId, 'owner', tx as never, true);
    // A retried send of the same message returns the original receipt, whatever the revision now is (AT16).
    const [dup] = await tx<{ id: string; op_id: string; op_status: string }[]>`
      SELECT t.id, o.id AS op_id, o.status AS op_status FROM rp.turn t LEFT JOIN rp.operation o ON o.learner_turn_id = t.id
       WHERE t.session_id = ${s.id} AND t.client_message_id = ${body.client_message_id}`;
    if (dup) return { status: 202, body: { session_id: s.id, accepted_turn_id: dup.id, operation_id: dup.op_id, status: dup.op_status, revision: s.revision, duplicate: true } };
    if (s.state === 'active' && Date.now() - new Date(s.last_activity_at).getTime() >= LIMITS.idle_expiry_minutes * 60000) {
      [s] = await tx<SessionRow[]>`UPDATE rp.session SET state = 'abandoned', abandon_reason = 'idle_expiry', revision = revision + 1 WHERE id = ${s.id} RETURNING *`;
    }
    if (s.state !== 'active') throw conflict('SESSION_NOT_ACTIVE', `This practice is ${s.state}; no further messages can be added.`, { state: s.state, revision: s.revision });
    if (s.revision !== body.expected_revision) throw conflict('STALE_REVISION', 'The conversation moved on since your last update. Refresh and try again.', { current_revision: s.revision });
    if (await pendingOp(s.id, tx as never)) throw conflict('RESPONSE_PENDING', 'Wait for the customer to reply before sending another message.', { revision: s.revision });
    if (s.learner_turn_count >= LIMITS.max_learner_turns) throw conflict('TURN_LIMIT', `This practice allows ${LIMITS.max_learner_turns} messages. Finish to get your report.`);
    const [{ next }] = await tx<{ next: number }[]>`SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM rp.turn WHERE session_id = ${s.id}`;
    const [t] = await tx<{ id: string }[]>`
      INSERT INTO rp.turn (tenant_id, session_id, sequence, speaker, text, client_message_id, origin)
      VALUES (${actor.tenant_id}, ${s.id}, ${next}, 'learner', ${body.text}, ${body.client_message_id}, 'live') RETURNING id`;
    if (voice) {
      await tx`
        INSERT INTO rp.turn_input (turn_id, tenant_id, session_id, mode, asr_provider, asr_text, asr_confidence, language, edited)
        VALUES (${t.id}, ${actor.tenant_id}, ${s.id}, 'voice', ${voice.asr_provider}, ${voice.asr_text}, ${voice.asr_confidence}, ${voiceLanguage},
                ${voice.asr_text.trim() !== body.text.trim()})`;
    }
    const [op] = await tx<{ id: string }[]>`
      INSERT INTO rp.operation (tenant_id, session_id, kind, status, learner_turn_id) VALUES (${actor.tenant_id}, ${s.id}, 'customer_turn', 'pending', ${t.id}) RETURNING id`;
    await enqueue(tx as never, actor.tenant_id, 'customer_turn', `customer_turn:${op.id}:1`, { operation_id: op.id, session_id: s.id });
    const [u] = await tx<{ revision: number }[]>`
      UPDATE rp.session SET revision = revision + 1, learner_turn_count = learner_turn_count + 1, last_activity_at = now(),
             elapsed_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint
       WHERE id = ${s.id} RETURNING revision`;
    return { status: 202, body: { session_id: s.id, accepted_turn_id: t.id, operation_id: op.id, status: 'pending', revision: u.revision, duplicate: false } };
  });
  return result;
}

/** Job: generate and commit the customer reply for one pending operation. */
async function processCustomerTurn(job: Job) {
  const opId = String(job.payload.operation_id);
  const [op] = await sql<{ id: string; tenant_id: string; session_id: string; status: string; learner_turn_id: string }[]>`SELECT * FROM rp.operation WHERE id = ${opId}`;
  if (!op || op.status !== 'pending') return;   // already done: a duplicate delivery is harmless
  const [s] = await sql<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${op.session_id}`;
  if (s.state !== 'active') {
    await sql`UPDATE rp.operation SET status = 'failed', error = ${sql.json({ code: 'SESSION_NOT_ACTIVE' } as never)}, updated_at = now() WHERE id = ${op.id} AND status = 'pending'`;
    return;
  }
  const bundle = await loadBundle(s.tenant_id, s.scenario_version_id, s.bundle_hash);
  const turns = await transcript(s.id);
  const learner = turns.find((t) => t.id === op.learner_turn_id);
  if (!learner) throw new PermanentJobError('Learner turn missing.');
  const history = turns.filter((t) => t.sequence < learner.sequence);
  const [disclosed, asked] = await Promise.all([
    sql<{ fact_id: string }[]>`SELECT fact_id FROM rp.disclosure_event WHERE session_id = ${s.id}`,
    sql<{ intent_id: string }[]>`SELECT DISTINCT i->>'intent_id' AS intent_id FROM rp.turn_analysis a, jsonb_array_elements(a.intents) i WHERE a.session_id = ${s.id} AND (i->>'question')::boolean`,
  ]);
  await spendProviderBudget(s.tenant_id);
  const template = (await promptContent(s.prompt_versions.roleplay.id));
  if (template.digest !== s.prompt_versions.roleplay.digest) throw new PermanentJobError('Pinned roleplay prompt digest mismatch.');
  const started = Date.now();
  const out = await respond({
    bundle, history, learnerText: learner.text, language: s.language ?? 'en',
    disclosed: new Set(disclosed.map((d) => d.fact_id)), askedIntentIds: new Set(asked.map((a) => a.intent_id)),
    template: template.content, correlation: { tenant_id: s.tenant_id, session_id: s.id, operation_id: op.id },
  });

  await sql.begin(async (tx) => {
    const [still] = await tx`SELECT status FROM rp.operation WHERE id = ${op.id} FOR UPDATE`;
    if (still.status !== 'pending') return;   // a concurrent worker finished it first
    const [locked] = await tx<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${s.id} FOR UPDATE`;
    if (locked.state !== 'active') {
      await tx`UPDATE rp.operation SET status = 'failed', error = ${tx.json({ code: 'SESSION_NOT_ACTIVE' } as never)}, updated_at = now() WHERE id = ${op.id}`;
      return;
    }
    const generationId = crypto.randomUUID();
    const [ct] = await tx<{ id: string }[]>`
      INSERT INTO rp.turn (tenant_id, session_id, sequence, speaker, text, generation_id, origin)
      VALUES (${s.tenant_id}, ${s.id}, ${learner.sequence + 1}, 'customer', ${out.reply.text}, ${generationId}, 'live') RETURNING id`;
    const hitFor = (factId: string) => {
      const rule = bundle.conversation.rules.find((r) => out.plan.matched_rule_ids.includes(r.id) && r.reveal_fact_ids.includes(factId));
      const hit = out.classification.hits.find((h) => rule?.intent_ids.includes(h.intent_id));
      return { intent: hit?.intent_id ?? null, confidence: hit?.confidence ?? null };
    };
    for (const f of out.reply.disclosed_fact_ids) {
      const h = hitFor(f);
      await tx`
        INSERT INTO rp.disclosure_event (tenant_id, session_id, fact_id, trigger_turn_id, intent_id, method, confidence, customer_turn_id, classifier_version)
        VALUES (${s.tenant_id}, ${s.id}, ${f}, ${learner.id}, ${h.intent}, ${out.reply.method === 'generated' ? 'generated' : 'fixture'}, ${h.confidence}, ${ct.id}, ${out.engine.classifier_version})
        ON CONFLICT (session_id, fact_id) DO NOTHING`;
    }
    await tx`
      INSERT INTO rp.turn_analysis (turn_id, tenant_id, session_id, intents, low_confidence, classifier_version, plan, generation)
      VALUES (${learner.id}, ${s.tenant_id}, ${s.id},
        ${tx.json(out.classification.hits.map((h) => ({ intent_id: h.intent_id, confidence: h.confidence, question: h.question, start: h.sentence.start, end: h.sentence.end })) as never)},
        ${out.classification.low_confidence}, ${out.engine.classifier_version}, ${tx.json(out.plan as never)},
        ${tx.json({ generation_id: generationId, method: out.reply.method, attempts: out.reply.attempts, validator: out.engine.output_validator_version, engine: ENGINE_VERSION, latency_ms: Date.now() - started, classifier_fallback: out.engine.classifier_fallback } as never)})`;
    await tx`UPDATE rp.operation SET status = 'succeeded', customer_turn_id = ${ct.id}, attempts = ${job.attempts}, updated_at = now() WHERE id = ${op.id}`;
    await tx`UPDATE rp.session SET revision = revision + 1, last_activity_at = now() WHERE id = ${s.id}`;
  });
  const rejected = out.reply.attempts.filter((a) => !a.ok).length;
  await metric('customer_turn_ms', Date.now() - new Date(learner.created_at).getTime(), { scenario: s.scenario_id, method: out.reply.method, rejected_candidates: rejected }, s.tenant_id);
  if (out.engine.classifier_fallback) await metric('classifier_fallback', 1, { scenario: s.scenario_id }, s.tenant_id);
  if (out.reply.method === 'fallback') await metric('roleplay_model_unavailable', 1, { scenario: s.scenario_id }, s.tenant_id);
  if (rejected) await metric('roleplay_output_rejected', rejected, { reasons: out.reply.attempts.filter((a) => !a.ok).map((a) => a.reason).join(',').slice(0, 80) }, s.tenant_id);
}

registerHandler('customer_turn', processCustomerTurn, async (job, error) => {
  // Retries exhausted: the learner turn stays; the operation fails visibly and can be retried (spec §19).
  await sql`UPDATE rp.operation SET status = 'failed', error = ${sql.json({ code: 'GENERATION_FAILED', retryable: true, message: 'The customer could not reply just now. Retry the reply.' } as never)}, updated_at = now()
            WHERE id = ${String(job.payload.operation_id)} AND status = 'pending'`;
  void error;
});

export async function getOperation(actor: Actor, opId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(opId)) throw notFound('Operation');
  const [op] = await sql<{ id: string; session_id: string; kind: string; status: string; customer_turn_id: string | null; run_id: string | null; error: unknown }[]>`
    SELECT id, session_id, kind, status, customer_turn_id, run_id, error FROM rp.operation WHERE id = ${opId} AND tenant_id = ${actor.tenant_id}`;
  if (!op) throw notFound('Operation');
  const s = await loadSessionFor(actor, op.session_id);
  const [turn] = op.customer_turn_id ? await sql`SELECT id AS turn_id, sequence, speaker, text, created_at FROM rp.turn WHERE id = ${op.customer_turn_id}` : [];
  return { operation_id: op.id, kind: op.kind, status: op.status, session_id: s.id, revision: s.revision, session_state: s.state, customer_turn: turn ?? null, run_id: op.run_id, error: op.error };
}

export async function retryOperation(actor: Actor, opId: string) {
  const [op] = await sql<{ id: string; session_id: string; kind: string; status: string }[]>`SELECT id, session_id, kind, status FROM rp.operation WHERE id = ${opId} AND tenant_id = ${actor.tenant_id}`;
  if (!op) throw notFound('Operation');
  await loadSessionFor(actor, op.session_id);
  if (op.kind !== 'customer_turn' || op.status !== 'failed') throw conflict('NOT_RETRYABLE', 'Only a failed customer reply can be retried.');
  return sql.begin(async (tx) => {
    const [s] = await tx<SessionRow[]>`SELECT * FROM rp.session WHERE id = ${op.session_id} FOR UPDATE`;
    if (s.state !== 'active') throw conflict('SESSION_NOT_ACTIVE', `This practice is ${s.state}.`);
    const [n] = await tx<{ attempts: number }[]>`UPDATE rp.operation SET status = 'pending', error = NULL, attempts = attempts + 1, updated_at = now() WHERE id = ${op.id} RETURNING attempts`;
    await enqueue(tx as never, actor.tenant_id, 'customer_turn', `customer_turn:${op.id}:${n.attempts + 1}`, { operation_id: op.id, session_id: op.session_id });
    await audit(actor, 'operation.retried', 'operation', op.id, {}, {}, tx as never);
    return { operation_id: op.id, status: 'pending' };
  });
}

// ---- finish and abandon -----------------------------------------------------------

export async function snapshotHash(turns: TranscriptTurn[]) {
  return sha256(canonicalJson(turns.map((t) => ({ id: t.id, sequence: t.sequence, speaker: t.speaker, text: t.text, origin: t.origin }))));
}

export async function finishSession(actor: Actor, sessionId: string, body: { expected_revision: number; cancel_pending?: boolean }) {
  await rateLimit(actor, 'finish');
  const { enqueueEvaluation } = await import('./evaluation');
  return sql.begin(async (tx) => {
    const s = await loadSessionFor(actor, sessionId, 'owner', tx as never, true);
    if (s.state !== 'active') throw conflict('SESSION_NOT_ACTIVE', `This practice is already ${s.state}.`, { state: s.state, revision: s.revision });
    if (s.revision !== body.expected_revision) throw conflict('STALE_REVISION', 'The conversation changed since your last update.', { current_revision: s.revision });
    const pending = await pendingOp(s.id, tx as never);
    if (pending) {
      if (!body.cancel_pending) throw conflict('RESPONSE_PENDING', 'The customer is still replying. Wait for the reply, or finish and cancel it.', { operation_id: pending.id });
      await tx`UPDATE rp.operation SET status = 'failed', error = ${tx.json({ code: 'CANCELLED_BY_FINISH' } as never)}, updated_at = now() WHERE id = ${pending.id}`;
      await audit(actor, 'operation.cancelled', 'operation', pending.id, { reason: 'finish' }, {}, tx as never);
    }
    const learnerTurns = await tx`SELECT 1 FROM rp.turn WHERE session_id = ${s.id} AND speaker = 'learner' AND origin = 'live' LIMIT 1`;
    if (!learnerTurns.length) throw conflict('NOTHING_TO_ASSESS', 'Say something to the customer before finishing.');
    const turns = await transcript(s.id, tx as never);
    const hash = await snapshotHash(turns);
    const [snap] = await tx<{ id: string }[]>`
      INSERT INTO rp.transcript_snapshot (tenant_id, session_id, last_sequence, content, hash)
      VALUES (${s.tenant_id}, ${s.id}, ${turns[turns.length - 1].sequence}, ${tx.json(turns.map((t) => ({ id: t.id, sequence: t.sequence, speaker: t.speaker, text: t.text, origin: t.origin, input_mode: t.input_mode })) as never)}, ${hash})
      RETURNING id`;
    await tx`UPDATE rp.session SET state = 'completed', completed_at = now(), transcript_hash = ${hash}, revision = revision + 1,
                   elapsed_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint WHERE id = ${s.id}`;
    const ev = await enqueueEvaluation(tx as never, { ...s, transcript_hash: hash }, snap.id, hash);
    await audit(actor, 'session.finished', 'session', s.id, { transcript_hash: hash, run_id: ev.run_id }, { after: hash }, tx as never);
    return { status: 202, body: { session_id: s.id, state: 'evaluating', transcript_hash: hash, operation_id: ev.operation_id, run_id: ev.run_id } };
  });
}

export async function abandonSession(actor: Actor, sessionId: string, body: { expected_revision: number; reason?: string }) {
  return sql.begin(async (tx) => {
    const s = await loadSessionFor(actor, sessionId, 'owner', tx as never, true);
    if (s.state !== 'active') throw conflict('SESSION_NOT_ACTIVE', `This practice is ${s.state}.`);
    if (s.revision !== body.expected_revision) throw conflict('STALE_REVISION', 'The conversation changed since your last update.', { current_revision: s.revision });
    const [u] = await tx<SessionRow[]>`UPDATE rp.session SET state = 'abandoned', abandon_reason = ${(body.reason ?? 'learner').slice(0, 200)}, revision = revision + 1 WHERE id = ${s.id} RETURNING *`;
    await tx`UPDATE rp.operation SET status = 'failed', error = ${tx.json({ code: 'SESSION_ABANDONED' } as never)} WHERE session_id = ${s.id} AND status = 'pending'`;
    await audit(actor, 'session.abandoned', 'session', s.id, { reason: body.reason ?? 'learner' }, {}, tx as never);
    return publicSession(u, await transcript(s.id, tx as never), null);
  });
}

export const assertOwnerLearner = (actor: Actor) => { if (!actor.roles.includes('learner') && !actor.roles.includes('author')) throw forbidden(); };
