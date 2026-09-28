# Runbook

## Signals

**Structured logs:**
- `kind: rp_metric` lines (disable with `RP_LOG_METRICS=0`) and `kind: rp_error` lines.
- They carry IDs, counts, durations and codes, and **never utterances**.
- Every API response carries an `x-request-id`, and the same ID appears in `rp_error` and `rp.audit_event.request_id`.

**Metrics** are stored in `rp.metric_event`:

| Metric | Meaning |
|---|---|
| `customer_turn_ms` | Tagged with `method` (fixture, generated, mixed, fallback, configured) and `rejected_candidates` |
| `roleplay_output_rejected` | Model output failed validation (leak, figure, entity, schema) |
| `evaluation_ms` | Tagged with `status` and `rejected_outputs` |
| `coaching_partial` | A report was published without coaching |
| `job_retry`, `job_failed` | Queue health |
| `api_request_ms` | Tagged with route and status |

**Alert on:**
- any `roleplay_output_rejected` with `hidden_fact:*` reasons (a leak attempt);
- a rising `job_failed`;
- repeated `evaluation_failed`;
- `CONFIG_INTEGRITY` errors.

```sql
SELECT name, count(*), avg(value) FROM rp.metric_event WHERE created_at > now() - interval '1 hour' GROUP BY 1;
```

## The queue

```sql
SELECT kind, status, count(*) FROM rp.job GROUP BY 1,2;                     -- health
SELECT id, kind, attempts, last_error FROM rp.job WHERE status = 'failed';  -- failures
```

- A worker that crashed mid-job leaves `status='running'` with an expired `lease_until`. The next `drain` reclaims it.
- To re-run a failed job, set `status='queued', run_after=now()`. Handlers are idempotent: a completed operation, run or report is skipped.

## Common incidents

| Symptom | Cause | Action |
|---|---|---|
| Learner sees "The customer could not reply" | Provider failures exhausted retries (`GENERATION_FAILED`) | Learner presses **Retry the reply**. Check provider status; the circuit breaker pauses calls for `RP_BREAKER_COOLDOWN_MS` after `RP_BREAKER_THRESHOLD` failures. |
| Report says "could not be assessed" | Evaluator output invalid twice, or transcript unscorable | Reviewer or tenant admin: `POST /v1/evaluations/{run}/retry` (same snapshot, new attempt). Inspect `rp.evaluation_run.outputs` for validator errors. |
| Report is "Provisional" | A review-consequence risk, a rule/model disagreement, or low confidence | Reviewer: **Review queue**; the decision is recorded with the original. |
| Report "feedback delayed" (`report_partial`) | Coach failed | Score and evidence stand. Re-queue the coach job (`idempotency_key LIKE 'coach:<run>%'`). |
| 429 `BUDGET_EXHAUSTED` | Tenant `daily_provider_call_budget` reached | Raise it in `rp.tenant.settings`, or wait; progress is kept. |
| 500 `CONFIG_INTEGRITY` | A pinned version or prompt is missing or altered | Never "fix" by pointing to latest. Restore the version row from backup. |

## Retention (spec §23, AT25)

- **Run:** `npm run rp:purge` deletes sessions older than each tenant's `retention_days` (default 180) with every derived row. Schedule it daily.
- **Audit rows** keep IDs and hashes only. Their own retention is an **open decision**.
- **Backups:** purged rows survive in backups until those expire. **After any restore, run `npm run rp:purge` before serving traffic**, so expired transcripts are not resurrected in serving paths. This procedure is documented but **not rehearsed** here.

## Changing prompts

Templates are approved by digest. Never edit `content/prompts/roleplay_v1.txt` in place; `ensurePrompts()` refuses a changed digest. Add `roleplay_v2.txt`, reference it from a new scenario version, and publish.

## Production must-dos before a pilot

1. Replace demo identity with SSO/OIDC (`service/auth.ts`).
2. Set `DEMO_MODE=false`, which disables act-as.
3. Choose a provider with approved data-use and region terms.
4. Implement redaction before provider submission.
5. Calibrate the evaluator.
6. Run a load test and a restore rehearsal.
7. Obtain product-owner sign-off on anchors, risk handling and retention (see RELEASE_VALIDATION).
