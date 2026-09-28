# Release validation: results as of 28 Sep 2026

**Environment:** local PostgreSQL 16 (disposable), `RP_PROVIDER=mock`, and a clean `ALLOW_DEMO_RESET=true npm run db:reset`. **No live model and no shared or production database was used.**

| Suite | Result |
|---|---|
| `npm run test:roleplay` (unit + integration) | **114 passed, 0 failed** on a fresh database. **113** on each later run: the builder-install check only runs while the synthetic scenario is absent. |
| Same suite at `PG_POOL_MAX=1` (serverless pool) | 113 passed |
| `npm test` (existing app acceptance suite) | 98 passed (unchanged) |
| `npm run test:serverless` | 98 passed |
| `npx tsc --noEmit`, `next build` | clean |

## Acceptance catalogue (spec §29)

| ID | Status | Evidence |
|---|---|---|
| AT01 | ✅ | Exact opening as turn 0; start payload has no private fields (unit + integration FR02) |
| AT02 | ✅ | Source partial answer; ₹4 lakh absent from reply and ledger |
| AT03 | ✅ | Four separate fixtures, each with only its own ledger events |
| AT04 | ✅ | Income, university name and EMI amount get no invented figure or entity |
| AT05 | ✅ | Immediate pitch gets the source burden objection; premature-pitch risk candidate |
| AT06 | ✅ | The opening's "MBA" gives no course credit without a learner question |
| AT07 | ✅ | "I cannot guarantee approval" and "Approval is not guaranteed" are not flagged |
| AT08 | ✅ | Exact learner span; routed to review; responsible = 1; reviewer upholds; final report |
| AT09 | ✅ | A question about someone else's promise is not a learner promise; the quoted form too |
| AT10 | ✅ | ₹10 lakh derived, labelled conditional; scholarship not subtracted |
| AT11 | ✅ | 22/30, 73.3%, "Good, but needs sharper follow-up" |
| AT12 | ✅ | 69.0% weighted (exact 69), raw 22 kept |
| AT13 | ✅ | Boundaries 12…30 correct; out-of-bounds score rejected |
| AT14 | ✅ | Missing sixth dimension and forged quote each reject the candidate |
| AT15 | ✅ **(mock only)** | Injection text leaks nothing through the rule path. Live-model adversarial testing **not done**. |
| AT16 | ✅ | Duplicate send and a re-delivered job give one learner turn, one reply, the same receipt |
| AT17 | ✅ | Concurrent sends: one accepted, one 409; gap-free sequence |
| AT18 | ✅ | Turn after finish rejected; snapshot hash equals recomputed hash |
| AT19 | ✅ | Running session stays pinned after a new major version; new sessions use the selected or newest |
| AT20 | ✅ | Focused retry: parent unchanged; checkpoint before first target; prefix earns no credit; no 30-point total |
| AT21 | ✅ | Cross-learner, cross-tenant and cross-team report and analytics denied without details |
| AT22 | ✅ | Invalid JSON twice gives `evaluation_failed`, no score; authorised retry succeeds on the same snapshot |
| AT23 | ✅ | Coach outage gives `report_partial` with the verified score visible |
| AT24 | ✅ | Synthetic scenario with a **new 1–4 dimension, weighted percent scoring and a cap** installed via the builder API, practised and scored with no code change. v1.1.0 was also imported, previewed, submitted and published **through the builder UI** in the browser. |
| AT25 | ⚠️ partial | Purge removes the session and all derived rows (tested). Backup restore **not rehearsed**; procedure in RUNBOOK. |
| AT26 | ✅ | Stored score recomputed exactly from saved scores and pinned policy (exact fraction 220/3) |

**Also tested:**
- Idempotency-Key replay and 409 on a different body.
- Rate limit 429 (retryable).
- Circuit breaker, retries, and no retry for non-retryable errors.
- Publication rules:
  - an author cannot publish;
  - published rows are immutable in the database;
  - a meaning change without a major bump is rejected.
- Analytics:
  - completion, focused-exclusion and risk-rate formulas;
  - version grouping;
  - small-cohort suppression.
- Audit coverage.
- Metric tags free of utterances.
- Code-point offsets with emoji and Devanagari.

## User flows verified in the browser (local, mock model)

1. **Learner:** start, then nine discovery turns. Every reply matched configuration: the D1 moratorium fallback and the unknown reply for the co-borrower. Finish led to a 21/30 report with anchored dimensions, evidence links, the no-risk statement and retry options.
2. **Focused retry:** the prefix is shown as context and the counter starts at 0.
3. **Learner promise:** the report is labelled provisional. The reviewer upholds in the Review queue.
4. **Author:** export, edit, import, then a validation panel with the semantic diff (minor bump). Preview (labelled test session, draft wording), submit, then the reviewer acknowledges and publishes.
5. **Manager:** version-grouped analytics with suppression.

## Not verified / not implemented

**Live model (Gemini, `gemini-2.5-flash` via the OpenAI-compatible endpoint), verified 28 Sep 2026 on a local database:**
- Customer replies generated live pass every output validator: "It's a private university in India." for an institution question, and an in-character, fact-free reaction to "Your loan will definitely be approved."
- The evaluator produced a full `EvaluationCandidate`. The first attempt was rejected (an `observed` claim without a learner span); the single repair attempt passed validation. The approval promise was routed to review, and a live coaching report validated.
- Three problems were found and fixed in doing this:
  1. Template-only JSON instructions produced a wrapped, incomplete object; each task now sends its contract as a JSON Schema.
  2. Reasoning tokens truncated output; `RP_LLM_REASONING_EFFORT=none` fixes this.
  3. The evaluator took over 30 seconds; it now has its own timeout (`RP_EVAL_TIMEOUT_MS`, default 120 s), and the API route has `maxDuration = 300`.
- **Not yet measured:** evaluator accuracy (calibration), live AT15 adversarial behaviour, latency distribution, and cost. The free tier exhausted after roughly 20 calls on `gemini-2.5-flash-lite`.

**Not implemented:**
- **Semantic (model) intent classifier.** Only deterministic matching is wired (ADR-004). Paraphrases outside the configured examples will be missed or clarified.
- **Redaction** of learner input before provider submission (spec §23).
- **Encrypted snapshot of rendered prompts** (spec §15): prompt digests and all outputs are stored; the rendered prompt text is not.
- **Cursor pagination** on list endpoints (fixed limit 100).
- **Server-sent events** (clients poll `GET /operations/{id}`).
- **Form editing** beyond metadata and brief: the other builder steps use the validated JSON editor.

**Needs people or infrastructure:**
- **Calibration** (≥30 labelled transcripts, two reviewers) and the proposed pilot gates (±1 on 90% of dimensions, 100% quote fidelity, zero false guarantee flags).
- **Load test** (100 concurrent sessions), p95 targets, and the restore rehearsal.
- **SSO/OIDC**, a membership admin UI, and encryption and secret management in production.

## Product-owner decisions still open (spec §2)

1. Approve the recommended 2/4 anchors and the risk consequences (all first-four risks are routed to review; `rubric_only` scoring).
2. Choose the provider and hosting region.
3. Set retention (default 180 days) and audit retention.
4. Set manager access scope and the small-cohort threshold.
5. Supply a reviewed product-policy knowledge pack if lending facts are to be assessed.
6. Approve the `nd_runtime` overlay (D1–D4) and the paraphrase and risk examples.
7. Define a readiness policy. Readiness is advisory only.
