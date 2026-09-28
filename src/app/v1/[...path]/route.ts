import { after } from 'next/server';
import { requestActor } from '@/modules/roleplay/service/auth';
import * as rp from '@/modules/roleplay/service';
import { ApiError, logError, metric, type Actor } from '@/modules/roleplay/service/context';
import { idempotent } from '@/modules/roleplay/service/guards';

/**
 * Roleplay platform HTTP API (spec §18). One router so every route shares the
 * same authentication, error envelope, request ID and job draining.
 *
 * Errors: {error:{code,message,retryable,request_id,details}}. Nothing hidden
 * (facts, prompts, provider bodies) ever appears in a response or a log line.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path: string[] }> };
type Handler = (a: Actor, m: string[], req: Request, body: any, url: URL) => Promise<{ status?: number; body: unknown; drain?: boolean }>;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^scenarios$/, async (a, _m, _r, _b, url) => ({ body: { items: await rp.publicScenarios(a, { product: url.searchParams.get('product') ?? undefined, skill: url.searchParams.get('skill') ?? undefined }) } })],
  ['GET', /^scenarios\/([^/]+)\/brief$/, async (a, m, _r, _b, url) => ({ body: await rp.getBrief(a, m[1], url.searchParams.get('version') ?? undefined) })],
  ['GET', /^sessions$/, async (a) => ({ body: { items: await rp.listMySessions(a) } })],
  ['POST', /^sessions$/, async (a, _m, req, body) => {
    const r = await idempotent(a, 'POST /sessions', req.headers.get('idempotency-key'), body, async () => ({ status: 201, body: await rp.startSession(a, body ?? {}) }));
    return { status: r.status, body: r.body };
  }],
  ['GET', /^sessions\/([^/]+)$/, async (a, m) => ({ body: await rp.getSession(a, m[1]) })],
  ['POST', /^sessions\/([^/]+)\/turns$/, async (a, m, _r, body) => { const r = await rp.submitTurn(a, m[1], body); return { status: r.status, body: r.body, drain: true }; }],
  ['GET', /^operations\/([^/]+)$/, async (a, m) => { const op = await rp.getOperation(a, m[1]); return { body: op, drain: op.status === 'pending' }; }],
  ['POST', /^operations\/([^/]+)\/retry$/, async (a, m) => ({ status: 202, body: await rp.retryOperation(a, m[1]), drain: true })],
  ['POST', /^sessions\/([^/]+)\/finish$/, async (a, m, req, body) => {
    const r = await idempotent(a, `POST /sessions/${m[1]}/finish`, req.headers.get('idempotency-key'), body, () => rp.finishSession(a, m[1], body ?? {}));
    return { status: r.status, body: r.body, drain: true };
  }],
  ['POST', /^sessions\/([^/]+)\/abandon$/, async (a, m, _r, body) => ({ body: await rp.abandonSession(a, m[1], body ?? {}) })],
  ['GET', /^sessions\/([^/]+)\/report$/, async (a, m) => { const r = await rp.getReport(a, m[1]); return { status: r.status, body: r.body, drain: r.status === 202 }; }],
  ['POST', /^sessions\/([^/]+)\/retries$/, async (a, m, req, body) => {
    const r = await idempotent(a, `POST /sessions/${m[1]}/retries`, req.headers.get('idempotency-key'), body, async () => ({ status: 201, body: await rp.startRetry(a, m[1], body ?? {}) }));
    return { status: r.status, body: r.body };
  }],
  ['GET', /^manager\/teams$/, async (a) => ({ body: { items: await rp.managedTeams(a) } })],
  ['GET', /^manager\/analytics$/, async (a, _m, _r, _b, url) => ({ body: await rp.managerAnalytics(a, { team_id: url.searchParams.get('team_id') ?? '', from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined, scenario_id: url.searchParams.get('scenario_id') ?? undefined }) })],
  ['GET', /^admin\/scenarios$/, async (a) => ({ body: { drafts: await rp.listDrafts(a), versions: await rp.listVersions(a) } })],
  ['POST', /^admin\/scenarios$/, async (a, _m, req) => ({ status: 201, body: await rp.createDraft(a, await req.clone().text()) })],
  ['GET', /^admin\/scenarios\/([^/]+)\/draft$/, async (a, m) => ({ body: await rp.getDraft(a, m[1]) })],
  ['PATCH', /^admin\/scenarios\/([^/]+)\/draft$/, async (a, m, _r, body) => ({ body: await rp.updateDraft(a, m[1], body?.bundle, Number(body?.expected_revision)) })],
  ['POST', /^admin\/scenarios\/([^/]+)\/validate$/, async (a, m) => ({ body: await rp.validateDraft(a, m[1]) })],
  ['POST', /^admin\/scenarios\/([^/]+)\/submit$/, async (a, m, _r, body) => ({ body: await rp.submitDraft(a, m[1], Number(body?.expected_revision)) })],
  ['POST', /^admin\/scenarios\/([^/]+)\/reject$/, async (a, m, _r, body) => ({ body: await rp.rejectDraft(a, m[1], String(body?.note ?? '')) })],
  ['POST', /^admin\/scenarios\/([^/]+)\/publish$/, async (a, m, req, body) => {
    const r = await idempotent(a, `POST /admin/scenarios/${m[1]}/publish`, req.headers.get('idempotency-key'), body, async () => ({ status: 201, body: await rp.publishDraft(a, m[1], Number(body?.expected_revision), String(body?.review_note ?? ''), body?.acknowledged === true) }));
    return { status: r.status, body: r.body };
  }],
  ['POST', /^admin\/scenarios\/([^/]+)\/preview$/, async (a, m) => {
    const v = await rp.createPreviewVersion(a, m[1]);
    const s = await rp.startSession(a, { scenario_id: '', preview_version_id: v.scenario_version_id });
    return { status: 201, body: { preview_version: v, session: s.session } };
  }],
  ['POST', /^admin\/scenarios\/([^/]+)\/retire$/, async (a, m, _r, body) => ({ body: await rp.retireVersion(a, m[1], String(body?.version ?? ''), String(body?.reason ?? '')) })],
  ['POST', /^admin\/versions\/([^/]+)\/draft$/, async (a, m) => ({ status: 201, body: await rp.draftFromVersion(a, m[1]) })],
  ['GET', /^admin\/versions\/([^/]+)\/export$/, async (a, m) => ({ body: await rp.exportVersion(a, m[1]) })],
  ['GET', /^evaluations\/reviews$/, async (a) => ({ body: { items: await rp.listReviewQueue(a) } })],
  ['POST', /^evaluations\/([^/]+)\/reviews$/, async (a, m, _r, body) => ({ status: 201, body: await rp.submitReview(a, m[1], body), drain: true })],
  ['POST', /^evaluations\/([^/]+)\/retry$/, async (a, m) => ({ status: 202, body: await rp.retryEvaluation(a, m[1]), drain: true })],
];

async function handle(method: string, req: Request, { params }: Params) {
  const path = (await params).path.join('/');
  const url = new URL(req.url);
  const started = Date.now();
  let actor: Actor | null = null;
  const requestId = crypto.randomUUID();
  try {
    actor = await requestActor();
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to use practice.');
    actor.request_id = requestId;
    const route = routes.find(([m, re]) => m === method && re.test(path));
    if (!route) throw new ApiError(404, 'NOT_FOUND', 'No such endpoint.');
    let body: unknown = null;
    if (method !== 'GET' && !path.match(/^admin\/scenarios$/)) {
      const text = await req.text();
      if (text) { try { body = JSON.parse(text); } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.'); } }
    }
    const res = await route[2](actor, path.match(route[1])!, req, body, url);
    // Queued work (the customer reply, evaluation, coaching) runs after the response is sent.
    if (res.drain) after(() => rp.drain({ budgetMs: 25000 }).catch((e) => logError('drain', e, { request_id: requestId })));
    await metric('api_request_ms', Date.now() - started, { route: route[1].source.slice(1, 40), status: res.status ?? 200 }, actor.tenant_id);
    return Response.json(res.body, { status: res.status ?? 200, headers: { 'x-request-id': requestId } });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL', 'Something went wrong. Your conversation is saved; please try again.', true);
    if (!(e instanceof ApiError) || err.status >= 500) logError(`api ${method} ${path.split('/')[0]}`, e, { request_id: requestId });
    const headers: Record<string, string> = { 'x-request-id': requestId };
    if (err.status === 429) headers['retry-after'] = String(err.details.retry_after_seconds ?? 60);
    return Response.json({ error: { code: err.code, message: err.message, retryable: err.retryable, request_id: requestId, details: err.details } }, { status: err.status, headers });
  }
}

export const GET = (req: Request, ctx: Params) => handle('GET', req, ctx);
export const POST = (req: Request, ctx: Params) => handle('POST', req, ctx);
export const PATCH = (req: Request, ctx: Params) => handle('PATCH', req, ctx);
