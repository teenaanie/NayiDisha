/**
 * Writes the contract JSON Schemas and the /v1 OpenAPI document to
 * docs/roleplay/contracts/, from the same definitions the code validates with.
 *   npm run rp:contracts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../src/modules/roleplay/contracts/schemas';

const dir = join(process.cwd(), 'docs/roleplay/contracts');
mkdirSync(dir, { recursive: true });
const schemas: Record<string, unknown> = {
  ScenarioBundle: S.bundleSchema, EvaluationCandidate: S.evaluationCandidateSchema, Evidence: S.evidenceSchema,
  RoleplayCandidate: S.roleplayCandidateSchema, CoachingCandidate: S.coachingCandidateSchema,
};
for (const [name, schema] of Object.entries(schemas)) {
  writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', title: name, ...(schema as object) }, null, 2) + '\n');
}

const err = { $ref: '#/components/responses/Error' };
const idem = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 }, description: 'Replaying the same key with the same body returns the original response; a different body returns 409.' };
const id = (n: string) => ({ name: n, in: 'path', required: true, schema: { type: 'string' } });
const op = (summary: string, roles: string, extra: Record<string, unknown> = {}) => ({ summary, description: `Roles: ${roles}.`, responses: { '200': { description: 'OK' }, '400': err, '401': err, '403': err, '404': err, '409': err, '422': err, '429': err, '503': err }, ...extra });
const body = (props: Record<string, unknown>, required: string[]) => ({ requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: props, required } } } } });

const openapi = {
  openapi: '3.0.3',
  info: { title: 'Practice coach API', version: '1.0.0', description: 'Roleplay coaching platform (docs/roleplay). Authentication is the app session cookie; tenant and learner identity always come from it, never from request bodies.' },
  servers: [{ url: '/v1' }],
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'nd_identity' } },
    responses: { Error: { description: 'Error envelope', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, request_id: { type: 'string' }, details: { type: 'object' } }, required: ['code', 'message', 'retryable', 'request_id'] } } } } } } },
  },
  security: [{ session: [] }],
  paths: {
    '/scenarios': { get: op('Published scenario summaries', 'learner', { parameters: [{ name: 'product', in: 'query', schema: { type: 'string' } }, { name: 'skill', in: 'query', schema: { type: 'string' } }] }) },
    '/scenarios/{id}/brief': { get: op('Public brief only', 'learner', { parameters: [id('id'), { name: 'version', in: 'query', schema: { type: 'string' } }] }) },
    '/sessions': {
      get: op('My attempts', 'learner'),
      post: op('Start a session pinned to a published version', 'learner (author/reviewer for preview_version_id)', { parameters: [idem], ...body({ scenario_id: { type: 'string' }, scenario_version: { type: 'string' }, preview_version_id: { type: 'string' } }, ['scenario_id']) }),
    },
    '/sessions/{id}': { get: op('Own session: public transcript, revision, pending operation', 'owner', { parameters: [id('id')] }) },
    '/sessions/{id}/turns': { post: op('Submit a learner turn (202; reply produced asynchronously)', 'owner', { parameters: [id('id')], ...body({ client_message_id: { type: 'string' }, text: { type: 'string', maxLength: 4000 }, expected_revision: { type: 'integer' } }, ['client_message_id', 'text', 'expected_revision']) }) },
    '/operations/{id}': { get: op('Operation status: pending, succeeded (with customer turn) or failed', 'owner', { parameters: [id('id')] }) },
    '/operations/{id}/retry': { post: op('Retry a failed customer reply', 'owner', { parameters: [id('id')] }) },
    '/sessions/{id}/finish': { post: op('Freeze the transcript and queue assessment (202)', 'owner', { parameters: [id('id'), idem], ...body({ expected_revision: { type: 'integer' }, cancel_pending: { type: 'boolean' } }, ['expected_revision']) }) },
    '/sessions/{id}/abandon': { post: op('Abandon; transcript kept, no score', 'owner', { parameters: [id('id')], ...body({ expected_revision: { type: 'integer' }, reason: { type: 'string' } }, ['expected_revision']) }) },
    '/sessions/{id}/report': { get: op('Report (200) or processing (202)', 'owner, manager of the learner\'s team, reviewer', { parameters: [id('id')] }) },
    '/sessions/{id}/retries': { post: op('Start a full or focused retry (201)', 'owner', { parameters: [id('id'), idem], ...body({ mode: { type: 'string', enum: ['full', 'focused'] }, retry_plan_id: { type: 'string' }, expected_assessment_id: { type: 'string' }, scenario_version: { type: 'string' } }, ['mode', 'retry_plan_id', 'expected_assessment_id']) }) },
    '/manager/teams': { get: op('Teams I manage', 'manager') },
    '/manager/analytics': { get: op('Version-grouped, suppressed team metrics', 'manager of team_id', { parameters: [{ name: 'team_id', in: 'query', required: true, schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'scenario_id', in: 'query', schema: { type: 'string' } }] }) },
    '/admin/scenarios': { get: op('Drafts and published versions', 'author, reviewer'), post: op('Create a draft from bundle JSON (body is the raw bundle)', 'author', { requestBody: { required: true, content: { 'application/json': { schema: { $ref: './ScenarioBundle.schema.json' } } } } }) },
    '/admin/scenarios/{id}/draft': { get: op('Draft', 'author, reviewer', { parameters: [id('id')] }), patch: op('Replace draft bundle', 'author', { parameters: [id('id')], ...body({ bundle: { type: 'object' }, expected_revision: { type: 'integer' } }, ['bundle', 'expected_revision']) }) },
    '/admin/scenarios/{id}/validate': { post: op('Errors, warnings, publication notes, semantic diff', 'author, reviewer', { parameters: [id('id')] }) },
    '/admin/scenarios/{id}/submit': { post: op('draft → in_review', 'author', { parameters: [id('id')], ...body({ expected_revision: { type: 'integer' } }, ['expected_revision']) }) },
    '/admin/scenarios/{id}/reject': { post: op('in_review → draft with a note', 'reviewer', { parameters: [id('id')], ...body({ note: { type: 'string' } }, ['note']) }) },
    '/admin/scenarios/{id}/publish': { post: op('Publish an immutable version (201)', 'reviewer (not the submitter unless the tenant allows)', { parameters: [id('id'), idem], ...body({ expected_revision: { type: 'integer' }, review_note: { type: 'string' }, acknowledged: { type: 'boolean' } }, ['expected_revision', 'acknowledged']) }) },
    '/admin/scenarios/{id}/preview': { post: op('Test-only version and preview session', 'author, reviewer', { parameters: [id('id')] }) },
    '/admin/scenarios/{scenarioId}/retire': { post: op('Retire a version; running sessions finish', 'reviewer', { parameters: [id('scenarioId')], ...body({ version: { type: 'string' }, reason: { type: 'string' } }, ['version', 'reason']) }) },
    '/admin/versions/{id}/draft': { post: op('Open a new draft from a published version', 'author', { parameters: [id('id')] }) },
    '/admin/versions/{id}/export': { get: op('Export a published bundle and its digest', 'author, reviewer', { parameters: [id('id')] }) },
    '/evaluations/reviews': { get: op('Review queue', 'reviewer') },
    '/evaluations/{id}/reviews': { post: op('Uphold/dismiss findings, optional overrides, rationale', 'reviewer (not the learner)', { parameters: [id('id')], ...body({ decisions: { type: 'array' }, dimension_overrides: { type: 'array' }, rationale: { type: 'string' } }, ['decisions', 'rationale']) }) },
    '/evaluations/{id}/retry': { post: op('Re-run a failed assessment on the same snapshot', 'reviewer, tenant_admin', { parameters: [id('id')] }) },
  },
};
writeFileSync(join(dir, 'openapi.json'), JSON.stringify(openapi, null, 2) + '\n');
console.log(`Wrote ${Object.keys(schemas).length} schemas and openapi.json to docs/roleplay/contracts/`);
