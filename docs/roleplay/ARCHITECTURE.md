# Architecture

## Module map (spec §4, §30)

| Spec module | Where | Notes |
|---|---|---|
| Contracts | `src/modules/roleplay/contracts/` | JSON Schemas (Ajv, unknown fields rejected), TS types |
| Configuration registry | `config/compile.ts`, `config/runtime-extension.ts`, `service/registry.ts` | Compile, validate, digest; lifecycle; semantic diff; preview |
| Session orchestrator | `service/sessions.ts` | Revisions, idempotency, one pending reply, idle expiry |
| Disclosure resolver | `runtime/intents.ts`, `runtime/disclosure.ts` | Deterministic classifier → rules → allowed facts |
| Roleplay adapter | `runtime/generate.ts`, `providers/` | Fixtures verbatim; model only for fact parts; output validator; safe fallback |
| Transcript service | `rp.turn`, `rp.transcript_snapshot` | Immutable turns (trigger); canonical hash at finish |
| Evaluation worker | `evaluation/extract.ts`, `evaluation/assess.ts`, `evaluation/validate.ts`, `service/evaluation.ts` | Rule evidence → candidate → validation (one repair) → reconcile → score |
| Scoring engine | `scoring/` | Exact rationals; unweighted and weighted; cap, deduction, gate |
| Coaching service | `coaching/` | Findings must cite stored evidence; quotes must be the learner's words |
| Admin application | `src/app/roleplay/admin/` | Form for metadata and brief; JSON for the rest, same validator |
| Analytics projector | `service/evaluation.ts` `projectAnalytics`, `service/analytics.ts` | Idempotent on `run_id`; version-grouped; suppression |
| Jobs and outbox | `service/jobs.ts`, `rp.job` | Leases, `SKIP LOCKED`, backoff, exhaustion handlers |
| Security, audit, observability | `service/context.ts`, `service/guards.ts`, `service/auth.ts` | Tenant scoping, `rp.audit_event`, sanitized `rp.metric_event` |

## Request and job flow

```
POST /v1/sessions/{id}/turns
  tx: lock session → dedupe client_message_id → check state, revision, pending, limits
      → insert learner turn + operation(pending) + job           (202 returned)
after(): drain → customer_turn job:
      classify → resolve disclosure → generate (fixtures verbatim; model for facts)
      → validate output (retry once, then safe reply)
      tx: insert customer turn + disclosure events + turn_analysis; op succeeded
POST /finish → tx: snapshot + hash, run(queued), op, job → evaluate job → coach job → analytics job
```

## Decisions

**ADR-001: Keep the existing stack; folders, not packages.** Spec §4 recommends a TypeScript web app, a relational DB, a queue and a provider-neutral adapter. The repo already is a TypeScript Next.js app on Postgres. The spec's `apps/` and `packages/` split became `src/modules/roleplay/*` subfolders with the same boundaries. The pure modules (contracts, config, runtime, evaluation, scoring, coaching) import no database code and are unit-tested in isolation.

**ADR-002: A Postgres job table instead of a separate queue.** It is durable and transactional with the data it changes (the turn and its job commit together), with leases and `SKIP LOCKED`. This is fine for the 100-session pilot target, but that target is unmeasured. Moving to a broker later only touches `service/jobs.ts`.

**ADR-003: `extensions.nd_runtime` for runtime behaviour the v1.0 schema cannot express.** Examples: question-free pitch intents, the discovery gate, absence checks, qualitative cue phrases, jargon terms and conditional derivations. Keys are validated with cross-references. The alternative, hard-coding "premature_pitch" or "avoids_guarantee" in code, would break FR01. Proposal: fold these into schema v1.1.

**ADR-004: A deterministic classifier by default; the model classifier is optional.** Spec §10 asks for deterministic matching for supported phrases plus a constrained semantic classifier. Only the deterministic half is implemented. Paraphrase coverage comes from configured examples. The `classify` task exists in the provider interface, but it is **not wired**. This is a known gap (RELEASE_VALIDATION).

**ADR-005: Mock evaluator semantics.** The mock maps satisfied checks to anchors: `min + round((max−min) × satisfied/total)`, with a confirmed risk placing a dimension at its lowest anchor. This lands on the spec's recommended 2/4 rule. It is a test instrument, **not** an assessment method; calibration of a live evaluator is a product-owner gate (§29).

**ADR-006: Identity.** Demo authentication is the app's HMAC cookie mapped to `rp.app_user`. An ADMIN may act as seeded synthetic accounts through a signed `rp_act_as` cookie, and only when `DEMO_MODE` is not `false`. Production must replace `requestActor()` with SSO/OIDC. Nothing downstream reads identity from anywhere else.

**ADR-007: Separate `rp` schema.** The platform survives `001_schema.sql` dropping `app`, and it is tenant-scoped where the app is not. Composite `(tenant_id, id)` foreign keys prevent cross-tenant references at the database level.

## Trust boundaries (spec §4, §15)

- **Learner payloads** carry the public brief and committed turns only. No facts, ledger, rules, anchors or prompts. This is tested in FR02 checks.
- **The roleplay model** sees authorised plus already-disclosed facts, persona style and history. It never sees scores, anchors, rubric, evaluator prompts or hidden facts.
- **The evaluator** is a separate call with the frozen transcript, rubric, rule evidence, risk policy and scenario truth, including the conditional derivations.
- **Templates** are platform assets in `content/prompts/`, approved by digest. Content enters them only as JSON data blocks. A changed template on disk fails `ensurePrompts()`; it must become a new ID.
