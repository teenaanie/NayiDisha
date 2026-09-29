/**
 * Roleplay integration tests against a real Postgres (local only). They call
 * the same service functions the /v1 API calls, as seeded synthetic actors.
 */
import { sql } from '../../src/lib/db';
import * as rp from '../../src/modules/roleplay/service';
import { actorFor, type Actor } from '../../src/modules/roleplay/service/context';
import { idempotent } from '../../src/modules/roleplay/service/guards';
import { seedRoleplay } from '../../src/modules/roleplay/service/seed';
import { loadScenarioPackage } from '../../src/modules/roleplay/config/content';
import { overrideProvider, ProviderError, type ModelProvider } from '../../src/modules/roleplay/providers';
import { scoreAssessment } from '../../src/modules/roleplay/scoring';
import type { ScenarioBundle } from '../../src/modules/roleplay/contracts/types';

/** The seeded Education Loan version (source 1.0.0 plus the overlay's bump). */
const EDU_BUNDLE = loadScenarioPackage('EDU_DISCOVERY_001').bundle as ScenarioBundle;
const EDU_V = EDU_BUNDLE.scenario.version;
const EDU_RUBRIC = (() => { const r = (loadScenarioPackage('EDU_DISCOVERY_001').bundle as ScenarioBundle).rubric; return `${r.id}@${r.version}`; })();
import { check, type Check } from './harness';

const HIDDEN = [/4 lakh/, /Riya/, /three weeks/, /applied for one/, /heavy EMI/, /savings_dilemma|savings_reservation|emi_concern/, /release_intents|reveal_fact_ids|anchors/];

export async function integrationTests(): Promise<Check[]> {
  const out: Check[] = [];
  const ok = (id: string, name: string, pass: boolean, detail = '') => out.push(check(id, name, pass, detail));
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://127.0.0.1').hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Integration tests mutate data; refusing to run against ${host}. Point DATABASE_URL at a local database.`);

  await seedRoleplay(() => {});
  const [nd] = await sql<{ id: string }[]>`SELECT id FROM rp.tenant WHERE slug = 'nayidisha'`;
  const [acme] = await sql<{ id: string }[]>`SELECT id FROM rp.tenant WHERE slug = 'acme-training'`;
  const as = async (t: string, subject: string) => (await actorFor(t, subject))!;
  const asha = await as(nd.id, 'synthetic:learner.asha');
  const vikram = await as(nd.id, 'synthetic:learner.vikram');
  const dev = await as(nd.id, 'synthetic:learner.dev');
  const neha = await as(nd.id, 'synthetic:manager.neha');
  const sanjay = await as(nd.id, 'synthetic:manager.sanjay');
  const meera = await as(nd.id, 'synthetic:author.meera');
  const rahul = await as(nd.id, 'synthetic:reviewer.rahul');
  const acmeLearner = await as(acme.id, 'synthetic:acme.learner');
  const acmeAdmin = await as(acme.id, 'synthetic:acme.admin');
  const drain = () => rp.drain({ budgetMs: 60000, maxJobs: 200 });
  // Rate counters from a previous run in the same minute would otherwise throttle this one.
  await sql`DELETE FROM rp.usage_counter WHERE bucket LIKE 'turn:%' OR bucket LIKE 'start:%' OR bucket LIKE 'finish:%'`;
  let msg = 0;
  const say = async (a: Actor, sid: string, text: string) => {
    const s = await rp.getSession(a, sid);
    const r = await rp.submitTurn(a, sid, { client_message_id: `m${++msg}-${Date.now()}`, text, expected_revision: s.revision });
    await drain();
    const op = await rp.getOperation(a, r.body.operation_id);
    return op.customer_turn?.text as string;
  };
  const finishAndReport = async (a: Actor, sid: string) => {
    const s = await rp.getSession(a, sid);
    await rp.finishSession(a, sid, { expected_revision: s.revision });
    await drain();
    return rp.getReport(a, sid);
  };

  // ---- AT01 / FR02: start, exact opening, no private fields -------------------
  const started = await rp.startSession(asha, { scenario_id: 'EDU_DISCOVERY_001', scenario_version: EDU_V });
  const sid = started.session.session_id;
  const payload = JSON.stringify(started);
  ok('AT01', 'Start returns the exact opening as turn 0', started.session.transcript[0]?.text.startsWith('Hello, my daughter has got admission for an MBA') && started.session.transcript[0].sequence === 0);
  ok('FR02', 'The start payload carries no hidden facts, rules or rubric internals', !HIDDEN.some((re) => re.test(payload)), payload.length + ' bytes');

  // ---- conversation with durable turns --------------------------------------------
  const r1 = await say(asha, sid, 'How much loan do you need?');
  ok('AT02', 'Via the API: loan-amount question gets the source partial answer', r1 === 'We are not sure. The course is around ₹14 lakh, but we have some savings.', r1);
  const [ledger] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM rp.disclosure_event WHERE session_id = ${sid} AND fact_id = 'savings'`;
  ok('AT02', 'Ledger: savings not disclosed after the loan-amount question', ledger.n === 0);
  const r2 = await say(asha, sid, 'How much can your family contribute comfortably?');
  const ev2 = await sql<{ fact_id: string; method: string }[]>`SELECT fact_id, method FROM rp.disclosure_event WHERE session_id = ${sid} AND trigger_turn_id IS NOT NULL ORDER BY created_at`;
  ok('AT03', 'Savings fixture recorded in the disclosure ledger with its trigger turn', r2.startsWith('We can arrange around ₹4 lakh') && ev2.some((e) => e.fact_id === 'savings' && e.method === 'fixture'), ev2.map((e) => e.fact_id).join(','));
  const sessView = JSON.stringify(await rp.getSession(asha, sid));
  ok('FR02', 'Session reads expose transcript only, never the ledger or facts', !/disclosure|fact_id|reveal_fact|release_intents/.test(sessView));

  // ---- AT16 duplicate send, AT17 concurrent sends --------------------------------
  const s16 = await rp.getSession(asha, sid);
  const body16 = { client_message_id: 'dup-16', text: 'When is the first fee payment due?', expected_revision: s16.revision };
  const a16 = await rp.submitTurn(asha, sid, body16);
  const b16 = await rp.submitTurn(asha, sid, body16);
  await drain(); await drain();
  const [cnt16] = await sql<{ l: number; c: number }[]>`SELECT count(*) FILTER (WHERE speaker='learner' AND client_message_id='dup-16')::int l, count(*) FILTER (WHERE speaker='customer' AND sequence = (SELECT sequence+1 FROM rp.turn WHERE session_id=${sid} AND client_message_id='dup-16'))::int c FROM rp.turn WHERE session_id = ${sid}`;
  ok('AT16', 'The same message sent twice gives one learner turn, one reply and a stable receipt', a16.body.operation_id === b16.body.operation_id && b16.body.duplicate && cnt16.l === 1 && cnt16.c === 1);
  // Worker timeout: the job is re-delivered after its lease; the duplicate run changes nothing.
  await sql`UPDATE rp.job SET status = 'queued', run_after = now() WHERE idempotency_key = ${`customer_turn:${a16.body.operation_id}:1`}`;
  await drain();
  const [after16] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM rp.turn WHERE session_id = ${sid}`;
  const [before16] = await sql<{ n: number }[]>`SELECT (max(sequence)+1)::int n FROM rp.turn WHERE session_id = ${sid}`;
  ok('AT16', 'A re-delivered reply job after a timeout adds no speech', after16.n === before16.n);
  const s17 = await rp.getSession(asha, sid);
  const both = await Promise.allSettled([
    rp.submitTurn(asha, sid, { client_message_id: 'c17a', text: 'Has the scholarship been confirmed?', expected_revision: s17.revision }),
    rp.submitTurn(asha, sid, { client_message_id: 'c17b', text: 'What is the total cost?', expected_revision: s17.revision }),
  ]);
  const rejected = both.filter((x) => x.status === 'rejected').map((x) => ((x as PromiseRejectedResult).reason as rp.ApiError));
  ok('AT17', 'Two messages at the same revision: one accepted, one 409', both.filter((x) => x.status === 'fulfilled').length === 1 && rejected.length === 1 && rejected[0].status === 409, rejected[0]?.code);
  await drain();
  const seqs = (await sql<{ sequence: number }[]>`SELECT sequence FROM rp.turn WHERE session_id = ${sid} ORDER BY sequence`).map((r) => r.sequence);
  ok('AT17', 'Transcript stays gap-free and ordered', seqs.every((s, i) => s === i), seqs.join(','));

  await say(asha, sid, 'What monthly repayment would feel manageable?');
  await say(asha, sid, 'Which course is she doing and which university is it?');
  await say(asha, sid, 'Your loan will definitely be approved.');

  // ---- finish, AT18, report, AT08 review -------------------------------------------
  const rep = await finishAndReport(asha, sid);
  const s18 = await rp.getSession(asha, sid);
  const [n18a] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM rp.turn WHERE session_id = ${sid}`;
  let err18 = '';
  try { await rp.submitTurn(asha, sid, { client_message_id: 'late', text: 'One more thing?', expected_revision: s18.revision }); } catch (e) { err18 = (e as rp.ApiError).code; }
  const [snap] = await sql<{ hash: string }[]>`SELECT hash FROM rp.transcript_snapshot WHERE session_id = ${sid}`;
  const [sess18] = await sql<{ transcript_hash: string }[]>`SELECT transcript_hash FROM rp.session WHERE id = ${sid}`;
  const [n18b] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM rp.turn WHERE session_id = ${sid}`;
  const recomputed = await rp.snapshotHash(await rp.transcript(sid));
  ok('AT18', 'A turn after finishing is rejected; transcript and its hash are unchanged', err18 === 'SESSION_NOT_ACTIVE' && snap.hash === sess18.transcript_hash && recomputed === snap.hash && n18a.n === n18b.n, err18);
  const [runRow] = await sql<{ id: string; status: string; review_reasons: string[]; score: { raw_total: number; band_label: string } }[]>`SELECT r.id, r.status, r.review_reasons, r.score FROM rp.evaluation_run r JOIN rp.session s ON s.current_run_id = r.id WHERE s.id = ${sid}`;
  ok('AT08', 'A confirmed approval promise routes the assessment to review', runRow.status === 'review_required' && runRow.review_reasons.some((x) => /guaranteed_approval/.test(String(x))), runRow.status);
  const finding = (await sql<{ rule_id: string; evidence_ids: string[] }[]>`SELECT rule_id, evidence_ids FROM rp.risk_finding WHERE run_id = ${runRow.id}`).find((f) => f.rule_id === 'guaranteed_approval');
  const [fev] = finding ? await sql<{ learner_spans: { quote: string }[] }[]>`SELECT learner_spans FROM rp.evidence WHERE run_id = ${runRow.id} AND id = ${finding.evidence_ids[0]}` : [];
  ok('AT08', 'The finding cites the exact learner span', fev?.learner_spans[0]?.quote === 'Your loan will definitely be approved.');
  const [dimR] = await sql<{ score: number }[]>`SELECT score FROM rp.dimension_score WHERE run_id = ${runRow.id} AND dimension_id = 'responsible'`;
  ok('AT08', 'The source anchor applies: responsible selling scores 1', dimR?.score === 1, String(dimR?.score));
  ok('§19', 'A provisional report is visible while review is pending', rep.status === 200 && (rep.body as { report_status: string }).report_status === 'provisional', (rep.body as { report_status: string }).report_status);
  const q = await rp.listReviewQueue(rahul);
  ok('§19', 'The reviewer queue lists it', q.some((x) => x.id === runRow.id));
  let selfReview = '';
  try { await rp.submitReview(asha, runRow.id, { decisions: [], rationale: 'x' }); } catch (e) { selfReview = (e as rp.ApiError).code; }
  ok('§3', 'A learner cannot review an evaluation', selfReview === 'FORBIDDEN');
  await rp.submitReview(rahul, runRow.id, { decisions: [{ rule_id: 'guaranteed_approval', decision: 'upheld', note: 'Clear affirmative promise.' }], rationale: 'Promise confirmed; anchor 1 stands.' });
  await drain();
  const final = await rp.getReport(asha, sid);
  const fb = final.body as unknown as { state: string; report_status: string; report: { strengths: { evidence_ids: string[] }[]; risky_statements: unknown[]; retry_plans: { full: { id: string }; focused: { id: string } } }; dimensions: unknown[]; evidence: { id: string }[] };
  ok('§20', 'After review the report is final with six evidence-backed dimensions', fb.state === 'reported' && fb.report_status === 'final' && fb.dimensions.length === 6, `${fb.state} ${fb.report_status}`);
  const evIds = new Set(fb.evidence.map((e) => e.id));
  ok('§20', 'Every report finding cites stored evidence', [...fb.report.strengths, ...(fb.report.risky_statements as { evidence_ids: string[] }[])].every((f) => f.evidence_ids.every((id) => evIds.has(id))));
  const leak = JSON.stringify(fb);
  ok('FR02', 'The learner report contains no hidden facts not disclosed to the learner', !/Riya Sharma|savings_dilemma|comfortable_contribution/.test(leak));

  // ---- AT26 / FR12: replay arithmetic without a model ----------------------------
  const [stored] = await sql<{ score: { raw_total: number; final_percent: number; band_id: string }; candidate: { dimension_scores: { dimension_id: string; score: number }[] } }[]>`SELECT score, candidate FROM rp.evaluation_run WHERE id = ${runRow.id}`;
  const [pinned] = await sql<{ bundle: ScenarioBundle }[]>`SELECT v.bundle FROM rp.session s JOIN rp.scenario_version v ON v.id = s.scenario_version_id WHERE s.id = ${sid}`;
  const replay = scoreAssessment(pinned.bundle.rubric, pinned.bundle.scoring, stored.candidate.dimension_scores.map((d) => ({ dimension_id: d.dimension_id, score: d.score })), { confirmedRiskRuleIds: ['guaranteed_approval'] });
  ok('AT26', 'A historical score recomputes exactly from saved scores and the pinned policy', replay.raw_total === stored.score.raw_total && replay.band_id === stored.score.band_id && replay.final_percent === stored.score.final_percent, `${replay.raw_total} ${replay.band_id}`);

  // ---- AT20 focused retry, full retry -----------------------------------------------
  const plans = fb.report.retry_plans;
  const parentTurnsBefore = (await sql`SELECT id, text FROM rp.turn WHERE session_id = ${sid} ORDER BY sequence`).map((t) => t.id + t.text).join('|');
  const focused = await rp.startRetry(asha, sid, { mode: 'focused', retry_plan_id: plans.focused.id, expected_assessment_id: runRow.id });
  const fsid = focused.session.session_id;
  ok('AT20', 'A focused retry clones the prefix as context', focused.session.transcript.every((t) => t.origin === 'retry_prefix') && focused.session.retry_scope?.mode === 'focused', `${focused.session.transcript.length} prefix turns`);
  await say(asha, fsid, 'When is the first fee payment due?');
  await say(asha, fsid, 'Has the scholarship been confirmed?');
  const frep = await finishAndReport(asha, fsid);
  const fbody = frep.body as unknown as { mode: string; report: { score: unknown; focused_results: { checks: { check_id: string; status: string }[] } } };
  const parentAfter = (await sql`SELECT id, text FROM rp.turn WHERE session_id = ${sid} ORDER BY sequence`).map((t) => t.id + t.text).join('|');
  ok('AT20', 'The parent attempt is unchanged', parentAfter === parentTurnsBefore);
  ok('AT20', 'Focused practice reports target checks, no comparable 30-point total', fbody.mode === 'focused' && fbody.report.score === null && fbody.report.focused_results.checks.length === 3, JSON.stringify(fbody.report.focused_results?.checks.map((c) => `${c.check_id}:${c.status}`)));
  // Targets are this learner's own missed questions (29 Sep 2026), so none was asked in the parent, and the fixed scenario list is not reused.
  const [parentRun] = await sql<{ candidate: { evidence: { check_id?: string; status: string }[] } }[]>`SELECT candidate FROM rp.evaluation_run WHERE id = ${runRow.id}`;
  const askedInParent = new Set(parentRun.candidate.evidence.filter((e) => e.status === 'observed' && e.check_id).map((e) => e.check_id!));
  const tgt = focused.session.retry_scope?.target_check_ids ?? [];
  ok('AT20', 'Focused targets are the learner\'s own missed questions, none already asked', tgt.length === 3 && tgt.every((id) => !askedInParent.has(id)) && JSON.stringify(tgt) !== JSON.stringify(EDU_BUNDLE.retry.focused_target_check_ids), `${tgt.join(',')} (asked: ${[...askedInParent].join(',')})`);
  const [frun] = await sql<{ candidate: { evidence: { check_id?: string; status: string }[] } }[]>`SELECT r.candidate FROM rp.evaluation_run r JOIN rp.session s ON s.current_run_id = r.id WHERE s.id = ${fsid}`;
  const prefixOnly = frun.candidate.evidence.find((e) => e.check_id === 'family_contribution');
  ok('AT20', 'A question asked only in the cloned prefix earns no credit (savings)', prefixOnly?.status === 'not_observed', prefixOnly?.status);
  const full = await rp.startRetry(asha, sid, { mode: 'full', retry_plan_id: plans.full.id, expected_assessment_id: runRow.id });
  ok('§20', 'A full retry starts fresh from the opening, pinned to the parent version', full.session.transcript.length === 1 && full.session.transcript[0].origin === 'opening' && full.session.scenario_version === started.session.scenario_version && full.session.retry_scope?.comparable === true);

  // ---- AT21 access isolation ---------------------------------------------------------
  const denied = async (fn: () => Promise<unknown>) => { try { await fn(); return 'allowed'; } catch (e) { return (e as rp.ApiError).status + ':' + (e as rp.ApiError).code; } };
  ok('AT21', 'Another learner cannot read the session (404, no details)', await denied(() => rp.getSession(vikram, sid)) === '404:NOT_FOUND');
  ok('AT21', 'A learner in another tenant cannot read it', await denied(() => rp.getSession(acmeLearner, sid)) === '404:NOT_FOUND');
  ok('AT21', 'The manager of the learner\'s team can read the report', (await denied(() => rp.getReport(neha, sid))) === 'allowed');
  ok('AT21', 'A manager of another team cannot', await denied(() => rp.getReport(sanjay, sid)) === '404:NOT_FOUND');
  const [northTeam] = await sql<{ id: string }[]>`SELECT id FROM rp.team WHERE name = 'North sales team'`;
  ok('AT21', 'Cross-team analytics are denied', (await denied(() => rp.managerAnalytics(sanjay, { team_id: northTeam.id }))).startsWith('403'));
  ok('AT21', 'Cross-tenant analytics are denied', (await denied(() => rp.managerAnalytics(acmeAdmin, { team_id: northTeam.id }))).startsWith('403'));
  ok('§3', 'A learner cannot publish configuration', (await denied(() => rp.publishDraft(asha, northTeam.id, 1, '', true))).startsWith('403'));

  // ---- idempotency keys ---------------------------------------------------------------
  const k = `k-${Date.now()}`;
  const i1 = await idempotent(vikram, 'POST /sessions', k, { scenario_id: 'EDU_DISCOVERY_001' }, async () => ({ status: 201, body: await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' }) }));
  const i2 = await idempotent(vikram, 'POST /sessions', k, { scenario_id: 'EDU_DISCOVERY_001' }, async () => ({ status: 201, body: await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' }) }));
  const i3 = await denied(() => idempotent(vikram, 'POST /sessions', k, { scenario_id: 'OTHER' }, async () => ({ status: 201, body: {} })));
  ok('§18', 'Replaying an Idempotency-Key returns the same session; different input is a 409', i2.replayed && (i1.body as { session: { session_id: string } }).session.session_id === (i2.body as { session: { session_id: string } }).session.session_id && i3 === '409:IDEMPOTENCY_KEY_REUSED');

  // ---- rate limits (spec §23) ---------------------------------------------------------
  await sql`UPDATE rp.tenant SET settings = settings || '{"rate_limits":{"start":2}}' WHERE id = ${acme.id}`;
  const starts = await Promise.allSettled([1, 2, 3].map(() => rp.startSession(acmeLearner, { scenario_id: 'EDU_DISCOVERY_001' })));
  await sql`UPDATE rp.tenant SET settings = settings - 'rate_limits' WHERE id = ${acme.id}`;
  const limited = starts.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason as rp.ApiError);
  ok('§23', 'Session starts beyond the tenant rate limit get a retryable 429', limited.length === 1 && limited[0].status === 429 && limited[0].retryable, limited.map((l) => l.code).join(','));

  // ---- AT22 invalid evaluator JSON twice, AT23 coach unavailable ---------------------
  const bad: ModelProvider = { id: 'broken', model: 'broken', live: false, complete: async () => ({ text: '{"not":"valid"', provider: 'broken', model: 'broken', request_id: null, usage: null, latency_ms: 1 }) };
  const s22 = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' })).session.session_id;
  await say(vikram, s22, 'When is the first fee payment due?');
  overrideProvider('evaluate', bad);
  const r22 = await finishAndReport(vikram, s22);
  overrideProvider('evaluate', null);
  const [run22] = await sql<{ status: string; score: unknown; outputs: unknown[] }[]>`SELECT r.status, r.score, r.outputs FROM rp.evaluation_run r JOIN rp.session s ON s.current_run_id = r.id WHERE s.id = ${s22}`;
  ok('AT22', 'Invalid evaluator JSON twice: visible failure, no fabricated score', run22.status === 'evaluation_failed' && run22.score === null && run22.outputs.length === 2 && (r22.body as { state: string }).state === 'evaluation_failed');
  const retried = await rp.retryEvaluation(rahul, (await sql`SELECT current_run_id FROM rp.session WHERE id = ${s22}`)[0].current_run_id);
  await drain();
  const [run22b] = await sql<{ status: string; attempt: number }[]>`SELECT status, attempt FROM rp.evaluation_run WHERE id = ${retried.run_id}`;
  ok('§19', 'An authorised retry re-evaluates the same snapshot as a new attempt', run22b.attempt === 2 && ['reported', 'review_required'].includes(run22b.status), `${run22b.status} attempt ${run22b.attempt}`);
  const s23 = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' })).session.session_id;
  await say(vikram, s23, 'What is the total cost of education?');
  overrideProvider('coach', { id: 'down', model: 'down', live: false, complete: async () => { throw new Error('coach offline'); } });
  const r23 = await finishAndReport(vikram, s23);
  overrideProvider('coach', null);
  const b23 = r23.body as { state: string; report_status: string; report: { score: { raw_total: number } } };
  ok('AT23', 'Coaching unavailable: verified score stays visible, labelled partial', b23.state === 'report_partial' && b23.report_status === 'partial' && typeof b23.report.score.raw_total === 'number', `${b23.state} ${b23.report?.score?.raw_total}`);

  // ---- AT19 version pinning; AT24 second scenario via builder ----------------------
  // Each run publishes the next major version, so pinning is tested fresh every time.
  const pinnedS = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' })).session.session_id;
  const [pinBefore] = await sql<{ bundle_hash: string; rubric_version: string; scenario_version: string }[]>`SELECT bundle_hash, rubric_version, scenario_version FROM rp.session WHERE id = ${pinnedS}`;
  const nextMajor = `${Number(pinBefore.scenario_version.split('.')[0]) + 1}.0.0`;
  const v1 = loadScenarioPackage('EDU_DISCOVERY_001').bundle as ScenarioBundle;
  const v2 = JSON.parse(JSON.stringify(v1)) as ScenarioBundle;
  v2.scenario.version = nextMajor; v2.rubric.version = nextMajor;
  v2.rubric.dimensions[5].anchors[4].description = `Uses simple language, checks understanding and summarises (test edit ${nextMajor}).`;
  v2.provenance.push({ path: '/rubric/dimensions/5/anchors/4/description', basis: 'recommendation', note: 'Integration-test edit for version pinning (AT19).' });
  await sql`UPDATE rp.scenario_draft SET status = 'discarded' WHERE scenario_id = 'EDU_DISCOVERY_001' AND status IN ('draft','in_review')`;
  const d2 = await rp.createDraft(meera, v2);
  await rp.submitDraft(meera, d2.draft_id, d2.revision);
  let selfPub = '';
  try { await rp.publishDraft(meera, d2.draft_id, d2.revision, 'x', true); } catch (e) { selfPub = (e as rp.ApiError).code; }
  ok('FR10', 'An author cannot publish (reviewer role required)', selfPub === 'FORBIDDEN');
  const minorBump = JSON.parse(JSON.stringify(v2)); minorBump.scenario.version = `${Number(nextMajor.split('.')[0]) - 1}.9.9`;
  const vr = await rp.validateBundleForTenant(nd.id, minorBump);
  ok('§22', 'A change to rubric meaning without a major version bump is rejected', !vr.ok && vr.errors.some((e) => /major version|greater than/.test(e.message)), vr.errors[0]?.message);
  await rp.publishDraft(rahul, d2.draft_id, d2.revision, 'AT19 test version', true);
  await say(vikram, pinnedS, 'When is the first fee payment due?');
  const [pinAfter] = await sql<{ bundle_hash: string; rubric_version: string }[]>`SELECT bundle_hash, rubric_version FROM rp.session WHERE id = ${pinnedS}`;
  const older = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001', scenario_version: EDU_V })).session;
  const latest = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001' })).session;
  ok('AT19', 'A running session stays pinned after a new rubric is published', pinAfter.bundle_hash === pinBefore.bundle_hash && pinAfter.rubric_version === pinBefore.rubric_version, pinAfter.rubric_version);
  ok('AT19', 'New sessions use the explicitly selected version, or the newest', older.scenario_version === EDU_V && latest.scenario_version === nextMajor, `${older.scenario_version} / ${latest.scenario_version}`);
  let immut = '';
  try { await sql`UPDATE rp.scenario_version SET bundle = '{}' WHERE tenant_id = ${nd.id} AND version = ${EDU_V}`; } catch (e) { immut = (e as Error).message; }
  ok('FR10', 'Published configuration cannot be edited in the database', /immutable/.test(immut));

  const synth = loadScenarioPackage('SYNTH_HEALTH_COVER_001').bundle;
  const [synthExists] = await sql`SELECT 1 FROM rp.scenario_version WHERE tenant_id = ${nd.id} AND scenario_id = 'SYNTH_HEALTH_COVER_001'`;
  if (!synthExists) {
    await sql`UPDATE rp.scenario_draft SET status = 'discarded' WHERE scenario_id = 'SYNTH_HEALTH_COVER_001' AND status IN ('draft','in_review')`;
    const d = await rp.createDraft(meera, JSON.stringify(synth));
    const val = await rp.validateDraft(meera, d.draft_id);
    await rp.submitDraft(meera, d.draft_id, d.revision);
    await rp.publishDraft(rahul, d.draft_id, d.revision, 'Synthetic AT24 scenario', true);
    ok('AT24', 'The synthetic scenario validates through the builder path', val.ok, `${val.errors.length} errors`);
  }
  const ss = (await rp.startSession(asha, { scenario_id: 'SYNTH_HEALTH_COVER_001', scenario_version: '1.0.0' })).session.session_id;
  const sr1 = await say(asha, ss, 'Who in the family needs cover?');
  const sr2 = await say(asha, ss, 'What yearly premium would be affordable?');
  await say(asha, ss, 'So the family is four people with only employer cover; to summarise, you want cover within your budget.');
  const srep = await finishAndReport(asha, ss);
  const sb = srep.body as unknown as { state: string; report: { score: { mode: string; raw_max: number; final_percent: number; band_label: string } }; dimensions: { dimension_id: string }[] };
  ok('AT24', 'The second scenario runs with no application-code change: customer uses its facts', sr1 === 'Myself, my husband and our two children.' && sr2 === 'Around ₹25,000 a year, not much more.', `${sr1} / ${sr2}`);
  ok('AT24', 'Its new dimension and weighted percent scoring are applied', sb.dimensions.some((d) => d.dimension_id === 'needs_summary') && sb.report.score.mode === 'weighted_percent' && sb.report.score.raw_max === 19, `${sb.report?.score?.final_percent}% ${sb.report?.score?.band_label}`);

  // ---- analytics -------------------------------------------------------------------
  const an = await rp.managerAnalytics(neha, { team_id: northTeam.id });
  const g = an.groups.find((x) => x.scenario_id === 'EDU_DISCOVERY_001' && x.rubric_version === EDU_RUBRIC);
  ok('FR11', 'Analytics group by scenario and rubric version', an.groups.every((x) => x.rubric_version && x.scoring_version) && !!g, an.groups.map((x) => `${x.scenario_id}@${x.rubric_version}`).join(' '));
  ok('FR11', 'Cohorts under five learners are suppressed', !!g && g.learners < 5 ? g.suppressed && g.metrics === null : true, `${g?.learners} learners`);

  // Metric formulas, with suppression lowered so the numbers are visible to the test.
  await sql`UPDATE rp.tenant SET settings = settings || '{"min_cohort":1}' WHERE id = ${nd.id}`;
  const an2 = await rp.managerAnalytics(neha, { team_id: northTeam.id });
  await sql`UPDATE rp.tenant SET settings = settings || '{"min_cohort":5}' WHERE id = ${nd.id}`;
  const g2 = an2.groups.find((x) => x.scenario_id === 'EDU_DISCOVERY_001' && x.rubric_version === EDU_RUBRIC)!;
  const [truth] = await sql<{ started: number; reported: number }[]>`
    SELECT count(*) FILTER (WHERE COALESCE(retry_scope->>'mode','full') = 'full')::int started,
           count(*) FILTER (WHERE COALESCE(retry_scope->>'mode','full') = 'full' AND state IN ('reported','report_partial'))::int reported
      FROM rp.session s WHERE rubric_version = ${EDU_RUBRIC} AND NOT is_preview
       AND learner_id IN (SELECT user_id FROM rp.team_membership WHERE team_id = ${northTeam.id} AND role = 'member')`;
  ok('FR11', 'Completion rate = reported full / started full sessions', !!g2.metrics && g2.counts.started_full === truth.started && g2.metrics.completion_rate === Math.round(1000 * truth.reported / truth.started) / 10, `${g2.metrics?.completion_rate}% of ${truth.started}`);
  ok('FR11', 'Focused attempts are excluded from averages and counted separately', !!g2.metrics && g2.counts.focused_attempts >= 1 && g2.eligible_assessments <= truth.reported, `${g2.counts.focused_attempts} focused`);
  ok('FR11', 'Risk rate counts sessions with a confirmed, not-dismissed risk', !!g2.metrics && g2.metrics.risk_rate !== null && g2.metrics.risk_rate > 0);

  // ---- abandon, AT25 retention ------------------------------------------------------
  const ab = (await rp.startSession(vikram, { scenario_id: 'EDU_DISCOVERY_001', scenario_version: EDU_V })).session;
  const abd = await rp.abandonSession(vikram, ab.session_id, { expected_revision: ab.revision, reason: 'test' });
  ok('§19', 'Abandoning preserves the transcript with no assessed score', abd.state === 'abandoned' && abd.transcript.length === 1);
  const purgeTarget = ab.session_id;
  await rp.purgeExpired(null, nd.id, { sessionIds: [purgeTarget] });
  const [gone] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM rp.session WHERE id = ${purgeTarget}) + (SELECT count(*) FROM rp.turn WHERE session_id = ${purgeTarget}) + (SELECT count(*) FROM rp.disclosure_event WHERE session_id = ${purgeTarget}) AS n`;
  ok('AT25', 'Retention purge removes the session and everything derived from it', Number(gone.n) === 0);

  // ---- live-model understanding (semantic classifier) and graceful degradation ---------
  {
    const fakeLive = (fn: (data: any) => string): ModelProvider => ({ id: 'fake_live', model: 'fake-live-1', live: true, complete: async (req) => ({ text: fn(req.data), provider: 'fake_live', model: 'fake-live-1', request_id: null, usage: null, latency_ms: 1 }) });
    const kiran = await as(nd.id, 'synthetic:learner.kiran');
    const ks = (await rp.startSession(kiran, { scenario_id: 'EDU_DISCOVERY_001', scenario_version: EDU_V })).session.session_id;
    // The model says the message asks two things (plus one invented intent, which must be dropped).
    overrideProvider('classify', fakeLive(() => JSON.stringify({ intents: [{ intent_id: 'fee_deadline', confidence: 0.95 }, { intent_id: 'total_cost', confidence: 0.9 }, { intent_id: 'made_up_intent', confidence: 0.99 }], is_question: true })));
    const r1 = await say(kiran, ks, 'when is the fee due and how much is the fee amount');
    ok('LIVE', 'A two-part question understood by the model gets both answers', /three weeks/.test(r1) && /14 lakh/.test(r1), r1);
    const [an] = await sql<{ intents: { intent_id: string }[]; classifier_version: string }[]>`SELECT a.intents, a.classifier_version FROM rp.turn_analysis a JOIN rp.turn t ON t.id = a.turn_id WHERE t.session_id = ${ks} ORDER BY t.sequence DESC LIMIT 1`;
    ok('LIVE', 'Only configured intents survive; the classifier version is recorded', an.intents.every((i) => i.intent_id !== 'made_up_intent') && an.classifier_version.startsWith('classifier_v1:'), an.classifier_version);
    // A paraphrase the phrase matcher cannot read, understood by the model as a repayment-comfort question.
    overrideProvider('classify', fakeLive(() => JSON.stringify({ intents: [{ intent_id: 'repayment_comfort', confidence: 0.9 }], is_question: true })));
    const r2 = await say(kiran, ks, 'What sort of monthly outgo would sit easily with your household budget?');
    ok('LIVE', 'A paraphrase the model understands reaches the right fixture', r2 === 'That is what worries me. I do not want a very heavy EMI later.', r2);
    // Classifier outage: the phrase matcher takes over and the conversation continues.
    overrideProvider('classify', { id: 'down', model: 'down', live: true, complete: async () => { throw new ProviderError('HTTP 429', false); } });
    const r3 = await say(kiran, ks, 'Has the scholarship been confirmed?');
    ok('LIVE', 'If the classifier fails, the phrase matcher answers instead', r3 === 'She has applied for one, but we do not know the result yet.', r3);
    // Roleplay model outage: authorised facts are stated plainly instead of failing the turn.
    overrideProvider('classify', null);
    overrideProvider('roleplay', { id: 'down', model: 'down', live: true, complete: async () => { throw new ProviderError('HTTP 429', false); } });
    const r4 = await say(kiran, ks, 'Which university is it?');
    overrideProvider('roleplay', null);
    const [g4] = await sql<{ method: string }[]>`SELECT a.generation->>'method' AS method FROM rp.turn_analysis a JOIN rp.turn t ON t.id = a.turn_id WHERE t.session_id = ${ks} ORDER BY t.sequence DESC LIMIT 1`;
    ok('LIVE', 'If the reply model is down, the customer still answers from configured facts', r4 === 'Private university in India.' && g4.method === 'fallback', `${r4} (${g4.method})`);
    const kv = await rp.getSession(kiran, ks);
    await rp.finishSession(kiran, ks, { expected_revision: kv.revision });
    await drain();
    const [krun] = await sql<{ candidate: { evidence: { check_id?: string; status: string }[] } }[]>`SELECT r.candidate FROM rp.evaluation_run r JOIN rp.session s ON s.current_run_id = r.id WHERE s.id = ${ks}`;
    const st = (c: string) => krun.candidate.evidence.find((e) => e.check_id === c)?.status;
    ok('LIVE', 'Scoring credits what the customer understood, including paraphrases', st('repayment_comfort') === 'observed' && st('total_cost') === 'observed' && st('fee_deadline') === 'observed', `repayment ${st('repayment_comfort')}, cost ${st('total_cost')}`);
  }

  // ---- voice (spec §3: same turn contract, ASR provenance, learner correction) --------
  {
    delete process.env.SARVAM_API_KEY;
    await rp.setVoiceConsent(dev, false);
    const vs = (await rp.startSession(dev, { scenario_id: 'EDU_DISCOVERY_001', scenario_version: EDU_V })).session.session_id;
    const view = await rp.getSession(dev, vs);
    ok('VOICE', 'Without a server speech provider, sessions offer browser recognition and speech', view.voice.recognition === 'browser' && view.voice.speech === 'browser' && view.voice.language === 'en-IN' && view.voice.consent === false);
    const heard = { mode: 'voice', asr_provider: 'browser:webspeech', asr_text: 'when is the first fee payment do', asr_confidence: 0.82 };
    let noConsent = '';
    try { await rp.submitTurn(dev, vs, { client_message_id: 'v1', text: 'When is the first fee payment due?', expected_revision: view.revision, input: heard }); } catch (e) { noConsent = (e as rp.ApiError).code; }
    ok('VOICE', 'A spoken turn is refused until the learner consents to voice', noConsent === 'VOICE_CONSENT_REQUIRED', noConsent);
    await rp.setVoiceConsent(dev, true);
    const r1 = await rp.submitTurn(dev, vs, { client_message_id: 'v1', text: 'When is the first fee payment due?', expected_revision: view.revision, input: heard });
    await drain();
    const op1 = await rp.getOperation(dev, r1.body.operation_id);
    const [prov] = await sql<{ asr_provider: string; asr_text: string; edited: boolean; language: string }[]>`SELECT asr_provider, asr_text, edited, language FROM rp.turn_input WHERE turn_id = ${r1.body.accepted_turn_id}`;
    ok('VOICE', 'The learner-corrected text is the turn; the raw transcript is kept as provenance', op1.customer_turn?.text === 'The first payment is due in about three weeks.' && prov?.asr_text === heard.asr_text && prov.edited === true && prov.language === 'en-IN', `${prov?.asr_provider} edited=${prov?.edited}`);
    const v2 = await rp.getSession(dev, vs);
    const r2 = await rp.submitTurn(dev, vs, { client_message_id: 'v2', text: 'Has the scholarship been confirmed?', expected_revision: v2.revision, input: { ...heard, asr_text: 'Has the scholarship been confirmed?' } });
    await drain();
    const [prov2] = await sql<{ edited: boolean }[]>`SELECT edited FROM rp.turn_input WHERE turn_id = ${r2.body.accepted_turn_id}`;
    ok('VOICE', 'An uncorrected transcript is recorded as not edited', prov2?.edited === false);
    const badInputs: [string, unknown][] = [['BAD_ASR_PROVIDER', { ...heard, asr_provider: 'evil' }], ['BAD_ASR_TEXT', { ...heard, asr_text: '' }], ['BAD_ASR_CONFIDENCE', { ...heard, asr_confidence: 7 }], ['BAD_INPUT_MODE', { ...heard, mode: 'video' }]];
    const codes: string[] = [];
    for (const [, input] of badInputs) { try { await rp.submitTurn(dev, vs, { client_message_id: 'bad' + codes.length, text: 'x?', expected_revision: (await rp.getSession(dev, vs)).revision, input }); codes.push('accepted'); } catch (e) { codes.push((e as rp.ApiError).code); } }
    ok('VOICE', 'Malformed voice provenance is rejected', JSON.stringify(codes) === JSON.stringify(badInputs.map((b) => b[0])), codes.join(','));
    let unavailable = '';
    try { await rp.transcribe(dev, vs, new Blob([new Uint8Array(10)])); } catch (e) { unavailable = (e as rp.ApiError).code; }
    ok('VOICE', 'Server transcription reports unavailable when no provider is configured', unavailable === 'VOICE_UNAVAILABLE');
    const view3 = await rp.getSession(dev, vs);
    ok('VOICE', 'The session transcript marks spoken turns', view3.transcript.filter((t) => t.input_mode === 'voice').length === 2);

    // Server path (Sarvam) with the network stubbed: no key exists here, so no call leaves the machine.
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    process.env.SARVAM_API_KEY = 'test-only';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      // The stub enforces Sarvam's documented request shape (docs, 29 Sep 2026), so a renamed field or retired model fails here.
      if (u.includes('/speech-to-text')) {
        const f = init?.body as FormData;
        if (!['saaras:v3', 'saaras:v4'].includes(String(f.get('model'))) || !/^[a-z]{2}-IN$/.test(String(f.get('language_code'))) || !(f.get('file') instanceof Blob)) return Response.json({ error: { message: 'bad stt request' } }, { status: 400 });
        calls.push('stt'); return Response.json({ request_id: null, transcript: 'Who will be the co-borrower?', language_code: 'en-IN' });
      }
      if (u.includes('/text-to-speech')) {
        const b = JSON.parse(String(init?.body));
        if (!['bulbul:v2', 'bulbul:v3'].includes(b.model) || !b.language_code || 'target_language_code' in b || (b.model === 'bulbul:v3' && !['aditya', 'shubh', 'rahul'].includes(b.speaker) && b.speaker !== process.env.SARVAM_TTS_SPEAKER)) return Response.json({ error: { message: 'bad tts request' } }, { status: 400 });
        calls.push('tts:' + b.text); return Response.json({ request_id: null, audios: ['UklGRg=='] });
      }
      return realFetch(url as never, init);
    }) as typeof fetch;
    try {
      const caps = (await rp.getSession(dev, vs)).voice;
      const tr = await rp.transcribe(dev, vs, new Blob([new Uint8Array(2048)], { type: 'audio/webm' }));
      ok('VOICE', 'With Sarvam configured, recognition runs on the server and returns an editable transcript', caps.recognition === 'server' && tr.transcript === 'Who will be the co-borrower?' && tr.asr_provider === 'sarvam:saaras_v3');
      const [audioRows] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'rp' AND data_type = 'bytea'`;
      ok('VOICE', 'Audio is never stored (no binary columns in the platform schema)', audioRows.n === 0);
      const custTurn = (await rp.getSession(dev, vs)).transcript.filter((t) => t.speaker === 'customer').pop()!;
      const sp = await rp.speak(dev, vs, custTurn.turn_id);
      ok('VOICE', 'Read-aloud speaks exactly a committed customer turn', sp.audio_base64 === 'UklGRg==' && calls.includes('tts:' + custTurn.text));
      const learnerTurn = (await rp.getSession(dev, vs)).transcript.find((t) => t.speaker === 'learner')!;
      const denied2 = async (fn: () => Promise<unknown>) => { try { await fn(); return 'allowed'; } catch (e) { return String((e as rp.ApiError).status); } };
      ok('VOICE', 'Read-aloud refuses learner turns and other learners\' sessions', await denied2(() => rp.speak(dev, vs, learnerTurn.turn_id)) === '404' && await denied2(() => rp.speak(vikram, vs, custTurn.turn_id)) === '404');
      await rp.setVoiceConsent(dev, false);
      ok('VOICE', 'Withdrawing consent stops server transcription', await denied2(() => rp.transcribe(dev, vs, new Blob([new Uint8Array(2048)]))) === '403');
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.SARVAM_API_KEY;
    }
    await rp.setVoiceConsent(dev, true);
    const vsv = await rp.getSession(dev, vs);
    await rp.finishSession(dev, vs, { expected_revision: vsv.revision });
    await drain();
    const vrep = (await rp.getReport(dev, vs)).body as unknown as { transcript: { input_mode: string; asr_edited: boolean | null }[]; dimensions: unknown[] };
    ok('VOICE', 'A voice session is assessed like any other; the report marks spoken and corrected turns', vrep.dimensions.length === 6 && vrep.transcript.some((t) => t.input_mode === 'voice' && t.asr_edited === true));
    const [snapV] = await sql<{ content: { input_mode?: string }[] }[]>`SELECT content FROM rp.transcript_snapshot WHERE session_id = ${vs}`;
    ok('VOICE', 'The frozen snapshot records which turns were spoken', snapV.content.filter((t) => t.input_mode === 'voice').length === 2);
  }

  // ---- audit and metrics ------------------------------------------------------------
  const [aud] = await sql<{ n: number }[]>`SELECT count(DISTINCT action)::int n FROM rp.audit_event WHERE action IN ('session.started','session.finished','scenario.published','evaluation.reviewed','retention.purged')`;
  ok('FR12', 'Audit events record starts, finishes, publications, reviews and purges', aud.n === 5, `${aud.n}/5 kinds`);
  const metricsText = JSON.stringify(await sql`SELECT tags FROM rp.metric_event ORDER BY id DESC LIMIT 200`);
  ok('§23', 'Metric tags carry no utterances', !/fee payment|4 lakh|definitely be approved/.test(metricsText));

  return out;
}
