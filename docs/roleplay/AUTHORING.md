# Authoring a scenario

A scenario is one JSON bundle (`ScenarioBundle`, schema in [contracts/ScenarioBundle.schema.json](contracts/ScenarioBundle.schema.json)). Author it in the builder (**Practice coach → Scenario builder**) or as `content/scenarios/<ID>/source.json` for seeding. Worked examples:

- `content/scenarios/EDU_DISCOVERY_001/`: the source scenario, its overlay and `DISCREPANCIES.md`.
- `content/scenarios/SYNTH_HEALTH_COVER_001/`: a clearly synthetic test scenario with a 1–4 dimension, weighted scoring, a cap, and one unknown fact.

## Rules the validator enforces

The validator reports each failure with its JSON-pointer path.

- **IDs, versions and size:** IDs match `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`; versions are `MAJOR.MINOR.PATCH`. The bundle is at most 1 MB, with ≤200 facts, ≤30 dimensions and ≤500 checks.
- **Unknown fields** are rejected everywhere except `extensions`. Duplicate JSON keys are rejected.
- **References** must resolve: intents, facts, checks, dimensions, concerns, risk rules and prompt templates. Circular fact prerequisites are rejected.
- **Unknown facts** must have `value: null`. Known facts must have a value of their declared type. Money is in **minor units**: ₹14 lakh = `140000000` paise.
- **Reachability:** every known `on_intent` fact must be revealed by some rule.
- **Anchors:** every integer score from `min_score` to `max_score` needs exactly one anchor.
- **Bands:**
  - `raw_sum` bands must cover every attainable total exactly once.
  - `percent` bands must run contiguously from 0 and include 100.
  - `weighted_percent` scoring must use percent bands and weight every dimension.
- **Risk effects:** `cap`, `deduction` and `gate` need their parameters (`rule_ids`, plus `max_percent`, `percent_points` or `outcome_label` respectively).
- **Versioning:** a new version must be greater than the latest published one. A change to scoring meaning (bands, weights, anchors, ranges or dimensions) needs a **major** bump.

## How the customer decides what to say

1. **Classify.** The learner turn is split into sentences. For each, the classifier scores every intent against its `positive_examples` and description topic, and keeps the best match per sentence. An intent only matches a **question** unless it is listed in `nd_runtime.question_free_intents`.
2. **Resolve.** Rules run by `priority` (highest first), then by ID. The highest-priority rule answers each intent. At most `max_new_facts_per_turn` new facts are released, and anything over the cap is deferred.
3. **Reply.**
   - A rule with `response_text` is an **exact fixture** and is used verbatim, with no model call.
   - Facts without a fixture are phrased by the model, which may use only those facts and ones already disclosed.
   - Recognised intents with only unknown facts get `unknown_response`.
   - Low-confidence questions get `clarification_response`.
   - Statements that ask nothing get `nd_runtime.acknowledgement_text`.

## `extensions.nd_runtime` (validated)

| Key | Meaning |
|---|---|
| `question_free_intents` | Intents that match statements too (a product pitch). |
| `discovery_gate.dimension_ids` | Discovery is complete once each listed dimension has at least one asked coverage check. |
| `discovery_conditioned` | Intents and risk rules that fire only *before* the gate is complete (early pitching, early documents). |
| `absence_checks` | Checks satisfied by *not* doing something: `risk_rule_ids` that contradict them, `unexplained_jargon`, `requires_discovery`. |
| `check_cues` | Phrases that evidence qualitative checks (summary, empathy, checking understanding). A live evaluator sees them as examples. |
| `jargon_terms` | Terms counted as jargon unless explained in the same turn. |
| `acknowledgement_text` | Neutral in-character reply to a non-question. |
| `derivations` | Server-side money arithmetic (`subtract`), always labelled conditional with assumptions. Given to the evaluator; never spoken, never a loan offer. |
| `discovery_gate.min_asked_checks` | Optional (default 1): distinct coverage checks that must be asked across the gate dimensions. Needed when the gate is a single discovery skill. |
| `translations` | Hindi/Marathi lines: opening, brief, every `response_text` (`rule_responses`), every volunteered cue (`cue_responses`), example questions, retry lead, reply and feedback instructions; `review_status` draft/reviewed. |
| `volunteered_cues` | Lines the customer adds unprompted once the learner has sent `after_learner_turns` messages, if none of `reveal_fact_ids` is out yet. One per turn, listed in due order. Optional `with_intents`: also said straight after the answer to one of these intents (keep the cue sentence out of that rule's fixed text, so it is never said twice). Optional `unless_fact_ids`: not said once any of these facts is out (the learner already covered what the cue points to). A fact a cue reveals needs no rule of its own. |
| `cue_follow_ups` | Checks earned by following a cue: after a customer turn states one of `cue_fact_ids`, a learner question on one of `follow_up_intents`. A cue that never came up makes the check not applicable. |
| `evaluation_guide` | The evaluator's knowledge base: `skills` (what each measures, what to look for, 1–5 guidance), `level_labels`, `framework` (priority order also orders "top missed questions"), `cues`, `variations`, `exclusions`, `principles`. The report reads `measures` and `level_labels`. |
| `reminder_minutes` | Practice reminders in minutes (default: the scenario's target range). |

## Provenance

Record `[S]`, `[R]` and `[U]` for every non-obvious value in `provenance[]` (`basis: source | recommendation | unspecified`). Unknown facts should each have an `unspecified` record; the validator warns if one is missing. The builder shows provenance beside the content.

## Publishing

The flow is draft → **Validate** → **Preview as learner** (test session, excluded from analytics) → **Submit** → a reviewer other than the submitter reads the notes, ticks the acknowledgement and clicks **Publish**. Published versions are immutable; **Edit as new draft** starts the next version. **Retire** blocks new starts, while running sessions finish on their pinned version.
