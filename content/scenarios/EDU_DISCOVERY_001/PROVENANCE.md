# EDU_DISCOVERY_001 v3.1.1: provenance

`source.json` is the v3 scenario, authored on 1 Oct 2026 from the owner's
**"Simulation Prototype"** document (text copy: `simulation-prototype.txt` in
this folder) and the owner's report-format table. It replaces the 2.1.0
package, which is archived unchanged in `content/archive/EDU_DISCOVERY_001/2.1.0/`
(sessions pinned to 2.1.0 keep it; the unit suite uses it as a fixture).

## Taken from the owner's documents
- **Skills, weights, scoring:** Questioning & Discovery 30%, Active Listening &
  Probing 30%, Understanding Customer Needs and Managing the Conversation 25%,
  Communication Clarity 15%; overall out of 100; 85–100 Strong, 70–84
  Effective, 55–69 Developing, below 55 Needs Coaching.
- **Anchors:** levels 1, 3 and 5 use the report-format table wording; levels 2
  and 4 use the document's evaluator rubric. The document's full 1–5 guidance
  and "look for" lists go to the evaluator in `evaluation_guide.skills`.
- **Customer profile:** daughter's college admission, ₹4 lakh, within 30 days,
  salaried, ₹55,000 a month, vehicle EMI ₹8,000, ₹10,000–₹12,000 comfortable
  extra EMI, affordable EMI then quick processing, worried about hidden charges
  after a previous vehicle loan, and the cue "Last time I was surprised by some
  additional charges."
- **Knowledge base:** discovery framework (not a checklist), cues and expected
  follow-ups, acceptable question variations, exclusions, evaluator principles.
- **Report:** per skill score / evidence / coaching, What went well, Areas of
  improvement, Top 3 questions that were missed.

## Owner decisions (1 Oct 2026)
- Mr. Sharma takes the document's profile, as a new major version.
- A confirmed serious risky statement caps the score at 54 (Needs Coaching)
  and goes to manager review (`scoring.risk_effect: cap`). Serious rules:
  guaranteed approval, documents dismissed, optional sold as compulsory, income
  falsification, and the new **charges misrepresented** (recommended because
  hidden charges are the customer's concern).
- 15 minutes is a target with reminders at 12 and 15; no forced end.
- The customer volunteers four cues: needing the money soon (opening), another
  EMI, not wanting a high EMI, extra charges on the previous loan. The
  document's "income varies" cue is left out (he is salaried).
- Tenure: not decided ("whatever keeps the EMI comfortable"). Title kept.
  "Best moment" and "Missed opportunity" are not part of the v3 report.

## Implementation recommendations [R]
- Intent IDs, example wordings beyond the owner's, fixed customer lines, cue
  timing (volunteered after the 3rd, 5th and 7th learner message if not yet
  said), discovery gate (three discovery questions before a pitch is in order),
  checks per skill, and all Hindi/Marathi text.
- **3.1.0 (3 Oct 2026), after the first live tests:** the daughter's details (Priya,
  B.Com, a college in Pune) so the customer can answer a natural question about her
  [R]; each cue sentence said once, straight after the answer it belongs to, instead of
  being baked into several fixed answers; the roleplay prompt `roleplay_v2` (answers
  what was asked, no repeats within a reply, natural replies to questions the facts do
  not cover); "not timing" examples for "how soon can you arrange those?".
- **3.1.1 (3 Oct 2026):** prompt `roleplay_v3`; a sub-question no fixed answer covers
  ("…and which bank gave you the loan?") gets a short reply after the fixed answer.
- **Hindi and Marathi are draft translations** (`review_status: "draft"`);
  they need a fluent reviewer.
