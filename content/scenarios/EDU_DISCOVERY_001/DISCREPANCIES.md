# EDU_DISCOVERY_001: discrepancies and how they were resolved

`source.json` is a byte-identical copy of `doc/education-loan-discovery.json` (sha256 `1883e5b40fff672d416bec952e44cdf4ad17f09c64bfe2763b629d6bbd386ccc`). It validates against the implemented schema **without modification** (0 errors, 0 warnings).

Nothing in `source.json` is edited. Every change is an operation in `overlay.json` with a `why`, applied at seed time and guarded by `test` operations that fail if the source changes underneath it. The overlay changes **no fact, fact value, anchor, band, weight or source response text**; the unit suite asserts this (`§25` checks).

| # | Discrepancy | Resolution | Basis |
|---|---|---|---|
| D1 | Spec §26 recommends "Could you explain what you mean by moratorium?" as the moratorium fallback. The JSON stores it only in `extensions.careerKore.moratorium_unknown_response`, a scenario-specific namespace a reusable platform must not read. The rule `disclose_moratorium_understanding` has no `response_text`, so the generic unknown reply would be used. | The text is copied verbatim into that rule's `response_text`. A `test` op asserts the source text first. Provenance records the move. | [R] per spec §26 |
| D2 | Each intent has exactly one positive example. The deterministic classifier (spec §10, "unambiguous supported phrases") cannot recognise ordinary paraphrases from one example. | 2–3 paraphrases were added per intent. These are learner-side wording only: no customer facts, amounts or entities. The source example stays first. | [R] |
| D3 | Each risk rule has one example. The source examples are kept, and a few paraphrases were added so the rule candidate detector is not keyword-literal. | Examples appended. Detection still requires affirmative assertion: it excludes negation, questions, attribution/quotation and hypotheticals. | [R] |
| D4 | The v1.0 schema has no field for: which intents match statements (a pitch), what "discovery complete" means for early-pitch detection (spec §10), which checks are satisfied by *absence* of a behaviour (e.g. `avoids_guarantee`), cue phrases for qualitative checks, jargon terms, a neutral acknowledgement line, or the conditional funding-gap arithmetic (spec §25, AT10). | Added as `extensions.nd_runtime`, the namespaced extension object the schema permits. The compiler validates every reference in it. See `docs/roleplay/AUTHORING.md`. | [R] |

## Carried-forward facts and deliberate non-changes

- **Unknown facts stay null.** These are `exact_university`, `income`, `emi_range`, `co_borrower_identity`, `expense_breakdown`, `scholarship_amount`, `comfortable_contribution` and `moratorium_understanding`. Questions that reach them get `unknown_response`, or for moratorium the D1 text. They are never populated.
- **Admission** is "Has received admission; further administrative confirmation unspecified", as in the source. The runtime states it verbatim and does not strengthen it.
- **The conditional gap** (₹14 lakh − ₹4 lakh = ₹10 lakh) is computed server-side and shown to the evaluator only, labelled conditional with both assumptions. The customer never states it, and it is never presented as a requested or approved amount.
- **`extensions.careerKore`** is retained untouched as provenance. The platform does not read it.
- **The evaluator's `responsible_selling_promise_score: 1`** in `careerKore` is honoured generically. A confirmed high-severity risk places its dimension at the lowest anchor in the mock evaluator. Any model score above min+1 alongside such a risk is routed to review (`evaluation/assess.ts` `reconcile`).
- **Jargon list:** "moratorium" is deliberately *not* treated as jargon, because the source expects learners to check the customer's understanding of it.
- **Product-policy accuracy** is not assessed. No knowledge pack exists (`knowledge_pack_status: absent`), and no lending terms are invented anywhere.
