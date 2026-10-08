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
| `openai_compatible` | Any `/chat/completions` endpoint: set `RP_LLM_BASE_URL`, `RP_LLM_MODEL`, and either `RP_LLM_API_KEY` or `RP_LLM_API_KEY_FROM` (the name of a variable holding the key). Optional: `RP_LLM_MODEL_EVALUATOR`, `RP_LLM_REASONING_EFFORT`. Each task's contract is sent as a JSON Schema for structured output, and the server still validates everything. **Verified live with Gemini on 28 Sep 2026** (see RELEASE_VALIDATION). |

**Gemini configuration used in production:**

```
RP_PROVIDER=openai_compatible
RP_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
RP_LLM_API_KEY_FROM=GEMINI_API_KEY
RP_LLM_MODEL=gemini-2.5-flash
RP_LLM_REASONING_EFFORT=none
```

The free tier allows only a small number of calls per model per day, and a session uses about 5–15. Enable billing on the Google project for more than a couple of sessions a day. Free-tier inputs may be used by Google to improve its products, so use synthetic conversations only.

Exact source fixtures and the opening line never call a model.

## Voice practice

- **How a spoken turn works.** Press 🎤, speak, then press Stop. What was heard appears in the message box. Correct it, then press Send. A spoken turn is never sent automatically, so assessment only sees words the learner confirmed (spec §3).
- **What is recorded.** The recogniser, the raw transcript and whether it was edited are stored as provenance (`rp.turn_input`). Audio is never stored.
- **Recognition.** By default this is the browser's own speech service (Chrome, Edge, Safari; Firefox has none, so learners type there). With `SARVAM_API_KEY`, recognition and read-aloud run on the server through Sarvam, which handles Indian accents better.
- **Consent.** The first use asks for voice consent (`PUT /v1/voice/consent`), with a notice saying where audio goes.
- **Read-aloud.** Tick "Read replies aloud" to hear the customer.

## Understanding the learner

- **With a live model,** each learner message is first classified by the model into the scenario's configured intents (multi-part questions included). Unknown IDs are discarded, and the model never sees facts.
- **The phrase matcher** is the fallback. It splits "X and Y?" into two questions.
- **If the reply model is unavailable** (quota, outage), the customer states the authorised facts plainly instead of failing the turn.
- **Scoring** credits the intents the runtime actually acted on, so paraphrases that the customer understood also count.
- **Model per task.** `RP_LLM_MODEL_CLASSIFIER` can point the classifier at a cheaper model.

## Graded assessment (score only)

After practising, a learner can take a graded assessment of the same scenario (`rp.session.kind = 'assessment'`, migration 022, `src/modules/roleplay/service/assessment.ts`). Same customer, same evaluator, same scoring; no coaching step.

- **Unlock and attempts.** Available once the learner has a practice report for the scenario. One attempt per scenario; a manager of the learner's team can allow one more ("Allow a retake" on Team analytics → Graded assessments, `rp.assessment_grant`), only after every allowed attempt is used. Every attempt stays on record. No retries, previews or older versions.
- **Learner sees** only the score sheet: overall score and band, and per skill the weight, the 1–5 score with its level name, and the weighted points (points add up to the score before any cap; "of this section" is score ÷ 5). A serious risky statement caps the score as in practice and shows it at once marked "under review"; a reviewer's decision makes it final (no coaching).
- **Managers and reviewers** see the score sheet plus risk flags, the skill evidence and the transcript; never coaching.
- **Operators** (NayiDisha operations and administrators, role `operator`, migration 023) use **Operations → Assessments** (`/ops/assessments`). It lists every learner in the tenant, signed-in candidates included, since they are on no team and have no manager. They can open any graded attempt in full and set how many attempts a learner has per scenario (1–10, never below the attempts already used; an attempt in progress counts as used). Raising the number adds grants. Lowering it withdraws the newest unused ones, which stay on record (`revoked_at`). Each change is audited as `assessment.attempts_set`.
- Assessments are listed separately for managers and excluded from practice analytics. The training agent reviews them too, without expecting coaching.

## Simulated candidates (operator menu → Simulated candidates)

AI candidates at three levels (needs improvement, competent, excellent; `content/simulation/candidates.json`, prompt `candidate_v1`, task `simulate` with `RP_LLM_MODEL_SIMULATOR`) practise with the AI customer through the real product (`src/modules/roleplay/service/simulation.ts`, migration 023).

- **Accounts.** `rp:seed` creates three synthetic learners (`sim:candidate.<level>`) in their own "Simulated candidates" team, which the demo administrator manages, plus a "Simulation runner" that owns automatic retakes. Real teams' analytics never include them.
- **A run.** Each candidate does N practice sessions (default 5, about 14 messages each, which is roughly a 10-minute conversation), then the graded assessment. Sessions are started, spoken, finished, assessed and coached by the same service functions as for people. Before each practice after the first, the candidate reads its previous report's coaching (skill tips, areas of improvement, missed questions) and applies it as its level would.
- **Calibration.** Expected bands: needs improvement below 55, competent 55–84, excellent 85 and above. The run page shows each candidate's practice trend, its assessment score and whether it landed in its band.
- **Training hand-off.** When a run finishes, the AI training agent is started with the calibration as tester notes. Sessions carry `simulated_candidate` in its digest, and `trainer_review_v5` tells it to check calibration and never coach the AI learner. That training run reviews exactly the simulation's sessions (`scope = 'sessions'`, migration 023): it does not move the weekly watermark, and period runs skip simulated learners.
- **Steps.** Work advances in small steps under a lease, with levels in parallel: the run page polls, and the daily cron advances leftovers. Repeated runs grant the candidates a retake automatically (audited).

## AI training agent (operator menu → AI training)

Reviews the practice sessions whose assessment finished since the last run and suggests improvements to the system, not the learner (`src/modules/roleplay/service/training.ts`, prompts `trainer_review_v5` and `trainer_merge_v2`, migrations 020 and 021). The report has two parts:

- **Conversation and scenario:** customer replies, question understanding, scenario content.
- **Assessment, feedback and framework:** scores and evidence (each check's outcome, quotes and method, risk flags, the cap), the learner-facing feedback and coaching (what went well, improvements, top missed questions, suggested questions, retry instruction), and the assessment framework itself (anchors, checks, weights, the evaluator guide, risk rule examples). The agent sees the full framework and every evidence item, quotes the report as well as the transcript (both are verified), and writes a separate assessment and coaching review.

- **Run log.** `rp.training_run` records the period each run assessed. The next run starts where the last successful one ended, so "reports assessed up to" is always known. A run covers at most 40 sessions, oldest first; the rest go to the next run. Runs started by a simulation (`scope = 'sessions'`) are left out of the watermark.
- **Tester notes.** One observation per line. The agent checks each against the transcripts (confirmed, partly, not found, not checkable) and turns confirmed ones into suggestions.
- **Outcomes, not raw statuses.** Each evidence item reaches the agent with the platform's outcome (met / missed / violated / unclear; an absence check's not_observed is met), and a follow-up carries what its first attempt was credited for.
- **Evidence is checked.** Every transcript quote must match the cited turn, and every report quote the session's report text; unmatched quotes are discarded, and an agent suggestion left with no evidence is dropped (one from a tester note is kept).
- **Human review.** Each suggestion is accepted (optionally with an edited change), rejected or left undecided. Approval needs every suggestion decided and writes a Markdown **build brief** (copy or download) to hand to a developer. Nothing changes live content by itself.
- **Steps.** A run is split into batches of 5 sessions, one model call each (about 30 s with 3.1 Pro), then a merge call. Work advances while the run page is open and from the daily cron (`/api/cron/ai-training`, 02:00 UTC), which also starts the weekly run on Mondays. A batch that fails 3 times fails the run, which can be retried.
- **Settings.** `RP_LLM_MODEL_TRAINER` (production: `gemini-3.1-pro-preview`; Gemini 2.5 Pro is closed to new API users), `RP_LLM_REASONING_EFFORT_TRAIN` (default `medium`; the global `none` does not apply), `RP_TRAIN_TIMEOUT_MS` (default 240 s), `CRON_SECRET` (required by the cron route). Calls appear on the AI usage page as "Practice coach — AI training agent".

## Conversation languages

A scenario can offer Hindi and Marathi alongside its source language (`extensions.nd_runtime.translations`, see AUTHORING.md). The learner chooses on the start card; the brief switches with the choice, and the whole session stays in that language, including retries (`rp.session.language`, migration 018).

- The customer's verbatim lines (opening, fixed answers, "I don't have that detail", clarification) come from the translation. Generated replies follow the translation's `reply_instruction` (Devanagari, everyday English banking words, Western digits for amounts so the figure checks still apply).
- Voice listens and speaks in `hi-IN` / `mr-IN` (Sarvam or the browser).
- Learners may type in Devanagari or Roman Hinglish. Questions without a "?" are recognised by Hindi, Marathi and Hinglish question words.
- The evaluator quotes the conversation exactly in its script and writes rationales in English. Scores, rubric names and page labels stay in English so managers can compare across languages. Coaching text and suggested questions are in the session language.
- Translations carry `review_status`. Until a fluent reviewer changes it to `reviewed`, the picker labels the language "Draft translation".
- The deterministic phrase matcher only knows the source language, so without a live model a Hindi or Marathi question gets a neutral acknowledgement instead of an answer.

## Scenario v3: the owner's evaluator design

`EDU_DISCOVERY_001` 3.0.0 follows the owner's "Simulation Prototype" (see `content/scenarios/EDU_DISCOVERY_001/PROVENANCE.md`; 2.1.0 is archived in `content/archive/`).

- **Four skills, weighted:** Questioning & Discovery 30%, Active Listening & Probing 30%, Understanding Customer Needs and Managing the Conversation 25%, Communication Clarity 15%. Each is scored 1–5; the server computes the overall score out of 100 (`scoring.mode: weighted_percent`), with bands 85–100 Strong, 70–84 Effective, 55–69 Developing, below 55 Needs Coaching. A confirmed serious risky statement caps the score at 54 and goes to manager review (`risk_effect: cap`).
- **Customer cues:** Mr. Sharma opens with "I need the money quite soon" and says "But I don't want a very high EMI", "And I already have another EMI" and "Also, my previous loan had extra charges" right after answering the amount, income and previous-loan questions, or unprompted by the 3rd, 5th and 7th message, each once and only if the learner has not already covered that topic (`nd_runtime.volunteered_cues`). Follow-ups to each cue are Active Listening checks (`nd_runtime.cue_follow_ups`); a cue that never came up is not applicable rather than missed.
- **Evaluator knowledge base** (`nd_runtime.evaluation_guide`): what each skill measures, what to look for, the owner's 1–5 guidance, the discovery framework (not a checklist), cues and expected follow-ups, acceptable question variations, and the exclusions that stop one behaviour being scored twice. `evaluator_v2` reads it; its answer (contract 1.1) gives every skill a rationale and one coaching suggestion.
- **Report** (owner's format): a table of Skill · What you are measuring · Weight · Your score · Evidence · Coaching feedback, the overall score and band with the interpretation line, a "What each level means" table, then What went well, Areas of improvement and Top 3 questions that were missed (in the framework's priority order).
- **Timing:** target 12–15 minutes; reminders at 12 and 15 (`nd_runtime.reminder_minutes`); no forced end.
- **4.0.0 (6 Oct 2026):** two more scored discovery areas, the cost breakup (₹4.5 lakh: ₹3 lakh tuition and admission, ₹1.2 lakh hostel and food, ₹30,000 books and other) and the customer's own contribution (₹50,000 from savings), plus when classes start. Open questions ("tell me about your requirement") count as asking the purpose. Generated replies may not use a fact's topic words before it is out, nor words that contradict the profile (`nd_runtime.hidden_fact_terms`, `forbidden_terms`), after a free reply invented "my son's college fees".

## Demo walkthrough (about 10 minutes)

1. **Learner (Farah):** Practice, then Education Loan, then Start. Ask "How much loan do you need?" and you get the source partial answer. Then ask about savings, scholarship, deadline and repayment. Finish, and the report shows six anchored dimensions with evidence that jumps to highlighted transcript spans.
2. **Focused retry:** the conversation resumes before the first targeted question, the prefix is greyed out as context, and only the three targets are assessed.
3. **Kiran:** say "Your loan will definitely be approved". The report is **provisional**; switch to **Rahul**, open the Review queue and uphold the finding, and the report becomes final.
4. **Meera (author):** in the Scenario builder, export the synthetic scenario, change a line, import it, validate (see the semantic diff), preview it as a learner, and submit. Then as **Rahul**, acknowledge and publish.
5. **Neha (manager):** Team analytics, grouped by rubric and scoring version. Cohorts under five learners are hidden.
