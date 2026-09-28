# Practice coach: AI roleplay coaching platform

A learner practises a sales discovery conversation with an AI customer. A separate evaluator assesses the transcript against a published rubric, and a coach turns verified findings into feedback and a retry plan. Scenarios, personas, hidden facts, disclosure rules, rubrics, risk rules and scoring are versioned configuration.

The contract is `doc/AI_Roleplay_Implementation_Specification.md` v1.0. It sits untracked in the main checkout. Section references (§) below are to that document.

| Doc | What it covers |
|---|---|
| [PROGRESS.md](PROGRESS.md) | Phase checklist; resume here |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map to the spec, decisions (ADRs), trust boundaries |
| [AUTHORING.md](AUTHORING.md) | Writing a scenario bundle, including `extensions.nd_runtime` |
| [ACCESS_MATRIX.md](ACCESS_MATRIX.md) | Who can do what, and how it is enforced |
| [RUNBOOK.md](RUNBOOK.md) | Worker, failures, review queue, retention, restore, provider outage |
| [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md) | AT01–AT26 results and what is **not** verified |
| [contracts/](contracts/) | JSON Schemas and `openapi.json` (regenerate: `npm run rp:contracts`) |

## Local setup

The requirements are Node 20+ and PostgreSQL 14+.

> **Warning:** `.env.local` in this repo usually points at the **shared Supabase demo database**. `db:reset` drops every schema, so always put a local `DATABASE_URL` in front of reset, seed and test commands, as below. A reset of a non-local host is refused unless you set `ALLOW_REMOTE_RESET=<that host>`.

1. Start a local Postgres, and create an empty database called `frontline`.

2. Rebuild both schemas and load both seeds against **that local database**: the app seed, and the roleplay seed (tenants, teams, synthetic accounts and the Education Loan scenario, published through draft → review → publish).

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5432/frontline ALLOW_DEMO_RESET=true npm run db:reset
   ```

   To add the platform to an existing database without resetting the app, run `npm run db:migrate && npm run rp:seed`. Migration `015` creates schema `rp` only, and the roleplay seed is idempotent.

3. Run the tests. The first command runs unit tests (no database) plus integration tests. The second runs only the unit tests. Both use the mock model.

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5432/frontline npm run test:roleplay
   ```

   ```bash
   npm run test:roleplay -- --unit
   ```

4. Run the app.

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5432/frontline npm run dev
   ```

   Then open <http://localhost:3000/roleplay>.

**Signing in.** Go to `/demo` and sign in as the demo administrator: locally the password is `demo-admin` unless `DEMO_PASSWORD` is set. Then use **Practice coach → Demo accounts** to act as any synthetic account. A candidate who signs in normally at `/sign-in` becomes a learner automatically.

**The job worker.** Queued work (the customer reply, assessment, coaching and analytics) runs after each API response. `npm run rp:worker` drains continuously, and `npm run rp:worker -- --once` drains once. You need the worker only when requests are not arriving, for example to pick up retries after backoff.

## Model providers

| `RP_PROVIDER` | Behaviour |
|---|---|
| `mock` (default) | Deterministic and offline. The customer states authorised facts plainly; the evaluator applies anchors mechanically to rule evidence; the coach fills templates. **All verification in this repo used the mock.** |
| `openai_compatible` | Any `/chat/completions` endpoint: set `RP_LLM_BASE_URL`, `RP_LLM_API_KEY`, `RP_LLM_MODEL`, and optionally `RP_LLM_MODEL_EVALUATOR`. Output passes the same validators as the mock. **Not exercised against a live endpoint; no credentials were available.** |

Exact source fixtures and the opening line never call a model.

## Demo walkthrough (about 10 minutes)

1. **Learner (Farah):** Practice, then Education Loan, then Start. Ask "How much loan do you need?" and you get the source partial answer. Then ask about savings, scholarship, deadline and repayment. Finish, and the report shows six anchored dimensions with evidence that jumps to highlighted transcript spans.
2. **Focused retry:** the conversation resumes before the first targeted question, the prefix is greyed out as context, and only the three targets are assessed.
3. **Kiran:** say "Your loan will definitely be approved". The report is **provisional**; switch to **Rahul**, open the Review queue and uphold the finding, and the report becomes final.
4. **Meera (author):** in the Scenario builder, export the synthetic scenario, change a line, import it, validate (see the semantic diff), preview it as a learner, and submit. Then as **Rahul**, acknowledge and publish.
5. **Neha (manager):** Team analytics, grouped by rubric and scoring version. Cohorts under five learners are hidden.
