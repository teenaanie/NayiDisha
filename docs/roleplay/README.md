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
- **Customer cues:** Mr. Sharma opens with "I need the money quite soon" and volunteers "I don't want a very high EMI", "I already have another EMI" and "my previous loan had extra charges" if the conversation has not reached them by the 3rd, 5th and 7th message (`nd_runtime.volunteered_cues`). Follow-ups to each cue are Active Listening checks (`nd_runtime.cue_follow_ups`); a cue that never came up is not applicable rather than missed.
- **Evaluator knowledge base** (`nd_runtime.evaluation_guide`): what each skill measures, what to look for, the owner's 1–5 guidance, the discovery framework (not a checklist), cues and expected follow-ups, acceptable question variations, and the exclusions that stop one behaviour being scored twice. `evaluator_v2` reads it; its answer (contract 1.1) gives every skill a rationale and one coaching suggestion.
- **Report** (owner's format): a table of Skill · What you are measuring · Weight · Your score · Evidence · Coaching feedback, the overall score and band with the interpretation line, a "What each level means" table, then What went well, Areas of improvement and Top 3 questions that were missed (in the framework's priority order).
- **Timing:** target 12–15 minutes; reminders at 12 and 15 (`nd_runtime.reminder_minutes`); no forced end.

## Demo walkthrough (about 10 minutes)

1. **Learner (Farah):** Practice, then Education Loan, then Start. Ask "How much loan do you need?" and you get the source partial answer. Then ask about savings, scholarship, deadline and repayment. Finish, and the report shows six anchored dimensions with evidence that jumps to highlighted transcript spans.
2. **Focused retry:** the conversation resumes before the first targeted question, the prefix is greyed out as context, and only the three targets are assessed.
3. **Kiran:** say "Your loan will definitely be approved". The report is **provisional**; switch to **Rahul**, open the Review queue and uphold the finding, and the report becomes final.
4. **Meera (author):** in the Scenario builder, export the synthetic scenario, change a line, import it, validate (see the semantic diff), preview it as a learner, and submit. Then as **Rahul**, acknowledge and publish.
5. **Neha (manager):** Team analytics, grouped by rubric and scoring version. Cohorts under five learners are hidden.
