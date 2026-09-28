# AI roleplay coaching platform: progress checklist

This contract is `doc/AI_Roleplay_Implementation_Specification.md` (v1.0, 28 Sep 2026), which lives untracked in the main checkout. The seed bundle is `content/scenarios/EDU_DISCOVERY_001/source.json`, a byte-identical copy of `doc/education-loan-discovery.json` (sha256 `1883e5b4…6ccc`).

Update this file whenever a box changes state, so work can resume across sessions.

## Repository assessment (before starting)

| Area | What exists | Decision |
|---|---|---|
| Stack | Next.js 15 App Router, React 19, TypeScript strict, postgres.js on Postgres/Supabase, raw SQL migrations, `tsx` scripts | Keep it. It meets the spec's TypeScript + relational DB baseline, so there is no separate `apps/`/`packages/` monorepo. The spec's package boundaries become folders under `src/modules/roleplay/` (see ADR-001 in `ARCHITECTURE.md`). |
| Auth | HMAC-signed cookie with a demo role switcher (`src/lib/auth.ts`). No real RBAC, no tenants | Roleplay adds its own tenant/user/membership/team tables and maps the app identity to a roleplay user. Real SSO/OIDC stays a production decision. |
| Jobs / queue | None. Server work runs inline or in `after()` | A DB-backed `rp.job` table with leases, attempts and backoff, plus a drain script (`npm run rp:worker`). `after()` kicks jobs immediately. |
| LLM | Raw-fetch adapters for Gemini, Claude and Sarvam; earlier simple `simulation` module (`/wa/practice`) | Left untouched as a working feature. The new platform has its own provider-neutral interface with a deterministic **mock** and an OpenAI-compatible **live** adapter. |
| Tests | `scripts/acceptance.ts` (98 checks, custom `check()` harness) | Same harness style in a new `scripts/roleplay-tests.ts`, which carries the spec's AT01–AT26 IDs. |

## Phase checklist

Legend: `[x]` done and tested, `[~]` partial (see note), `[ ]` not started.

### Phase 1: Foundation
- [x] JSON Schema for every contract in spec §8–16, plus TS types (`src/modules/roleplay/contracts/`)
- [x] Config compiler: schema, cross-field checks, canonical digest, strict JSON (`config/compile.ts`)
- [x] Source bundle validates unmodified; overlay of 95 reviewed ops; discrepancies D1–D4 recorded in `content/scenarios/EDU_DISCOVERY_001/DISCREPANCIES.md`
- [x] Deterministic scoring (unweighted, weighted, exact rationals, bands, cap/deduction/gate) (`scoring/`)
- [~] State machines: enforced in the session service (Phase 2), not a separate module
- [x] Disclosure fixtures AT01–AT05, AT15 pass without an LLM (`npm run test:roleplay -- --unit`)

### Phase 2: Text practice
- [x] Migration `015_roleplay_platform.sql` (schema `rp`, tenant-scoped composite FKs, immutability triggers)
- [x] Session API `/v1/...` with idempotency keys, revisions, operations (`src/app/v1/[...path]/route.ts`; OpenAPI in `contracts/`)
- [x] Deterministic intent classifier, disclosure resolver, generation with output validation and safe fallback
- [~] Semantic model classifier: interface exists, not wired (ADR-004)
- [x] Learner UI (`/roleplay`, `/roleplay/s/[id]`, `/roleplay/attempts`)

### Phase 3: Assessment and coaching
- [x] Rule evidence, risk candidates, candidate validation (quotes, spans, attribution, cardinality), one repair, reconciliation → review
- [x] Deterministic score; coaching with evidence-linked findings; `report_partial`; provisional reports
- [x] Review queue (uphold/dismiss, overrides with original kept)
- [x] Full and focused retries (checkpoint before first target; prefix excluded from credit)
- [ ] Calibration against labelled transcripts (needs reviewers and a live model)

### Phase 4: Administration and analytics
- [x] Draft / validate / submit / reject / publish / retire; JSON import/export; semantic diff; preview sessions
- [~] Builder form editing covers metadata and brief; other steps use the validated JSON editor
- [x] Manager analytics (team-scoped, version-grouped, suppression, stated metric definitions)
- [x] Second synthetic scenario (`SYNTH_HEALTH_COVER_001`) installed by configuration only (AT24)

### Phase 5: Production readiness (in-repo parts)
- [x] Access matrix enforced and tested; audit events; sanitized metrics; rate limits; provider budget; circuit breaker; retention purge
- [x] Docs: README (setup), ARCHITECTURE (ADRs), AUTHORING, ACCESS_MATRIX, RUNBOOK, RELEASE_VALIDATION
- [ ] Live provider verification, redaction, SSO, load test, restore rehearsal, product-owner approvals (see RELEASE_VALIDATION)

## Blockers and open decisions
- No provider credentials: every verification used the mock. The live adapter is unexercised.
- The product-owner decisions in spec §2 are unresolved by design; listed in RELEASE_VALIDATION.
