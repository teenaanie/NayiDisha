# Applicant Onboarding Agent — proposal for review

Three sample outputs, plus the answer to the success question. Nothing here is
written to the product yet. `CLAUDE.md` gets written only after you approve.

---

## Part 1 — The success answer: what is the optimal onboarding time?

### What the code actually demands

A candidate is only useful to NayiDisha when the matching engine calls them a
**Qualified Profile**. Reading `src/modules/matching/index.ts` against the
published `CFG-BFSI-RE-1` config, that is a fixed list — it is not negotiable by
UX preference:

| Stage | Gate | Input it needs from the applicant |
|---|---|---|
| A | `AGE_NOT_CONFIRMED_18` | age 18+ declaration |
| A | `PROCESSING_CONSENT_ABSENT` | PROCESSING consent |
| A | `COMMUTE_EXCEEDS_CANDIDATE_LIMIT` | locality + max commute minutes |
| A | `SHIFT_INCOMPATIBLE` | shift availability |
| A | `SALARY_INCOMPATIBLE` | expected pay |
| A | `NO_REQUIRED_LANGUAGE` | languages spoken |
| B | `MOBILE_NOT_VERIFIED` | phone + OTP |
| B | `PROFILE_INCOMPLETE` | name, experience months, experience tags |
| B | `WORK_AUTHORISATION_REQUIRED` | work authorisation declaration |
| B | `REQUIRED_FIELD_field_sales_comfort` | field sales comfort |
| B | `NO_APPLICATION` / `INTEREST_NOT_RECONFIRMED` | apply, then reconfirm |
| B | `ASSESSMENT_BELOW_60` | 5-question assessment, ≥60% |

That is **11 captured inputs + OTP + consent + 5 assessment questions + 2
interest actions**. Roughly 21 interactions. Nothing can be dropped without
changing the config — and changing the config is your decision, not the agent's.

### Turn cost, measured against the existing voice journey

The voice journey (`src/app/wa/voice-journey.tsx`, `voice-actions.ts`) speaks a
question, takes a spoken answer, and reads the value back whenever interpreter
confidence is under `CONFIRM_THRESHOLD = 0.72`.

| Turn type | Time |
|---|---|
| Spoken question + spoken answer + accepted first try | ~16–18 s |
| Same, but read back and confirmed | ~26–28 s |
| Assessment question (4 options, read aloud) | ~20 s |
| OTP entry | ~30 s |
| Consent screen (3 toggles, 1 required) | ~20 s |
| Two legal checkboxes (deliberately not voice-inferred) | ~15 s |

At an observed-in-demo read-back rate of roughly 1 in 4 answers, a single
uninterrupted sitting runs **5 min 30 s to 7 min**. That is past the point where
a frontline worker standing at a partner's QR sticker will finish.

### The recommendation

**Split the journey at 2 min 45 s. Never let sitting one exceed 4 minutes.**

**Sitting 1 — "enough to be shortlisted", target 2:45, hard cap 4:00.**
Phone, OTP, PROCESSING consent, then the seven voice fields (name, locality,
experience, skills, expected pay, commute, shift), then the two declarations.
Eleven turns. This clears the whole of Stage A and everything in Stage B except
the assessment and the interest actions. The applicant ends holding a real
shortlist of live jobs with a commute and a pay figure against each — a visible
payoff, at the moment their attention is still there.

**Sitting 2 — "assessment", ~2:00, triggered only by a live match.**
The 5-question assessment plus apply and reconfirm. Sent as a WhatsApp alert
when a job actually matches, not before.

The reason to defer the assessment specifically: it is worth **5% of the score
weight** (`scoring_weights.assessment: 5`) but costs **~30% of total journey
time**, and it is the only step with a pass/fail wall (`ASSESSMENT_BELOW_60`).
Asking someone to risk failing a test before they have seen a single job is the
worst possible ordering. Commute is weighted 20 and takes one turn — that is the
ratio to optimise for.

**Why 2:45 and not shorter:** below this you must cut a Stage A gate, which
means the engine returns an ineligible candidate and an employer wastes an
unlock credit. Speed that produces unqualified profiles costs you real money
through `ledger` reversals.

**Honest caveat:** these are design targets derived from the field list and the
turn mechanics in your code. There is **no measured drop-off data in this
repo** — no funnel events, no per-step timing. The evaluator sub-agent scores
against these targets, but the targets themselves need one instrumented cohort
before they are anything more than a well-grounded estimate. See the open
questions.

---

## Part 2 — How the agent is structured

```
onboarding-agent  (orchestrator)
├── onboarder      sub-agent 1 — runs the journey, produces the Onboarding Record
└── journey-critic sub-agent 2 — scores the record against the success criteria
```

The orchestrator loops: onboarder produces → critic scores → if any criterion
fails, the critic's findings go back to the onboarder with the specific turn to
fix → repeat. It stops when the critic passes it, or after 3 rounds, at which
point it reports the failure rather than declaring success.

The critic is scored on five criteria:

| # | Criterion | Pass condition |
|---|---|---|
| C1 | Time to shortlist | ≤ 4:00, target ≤ 2:45 |
| C2 | Stage A completeness | zero Stage A reasons outstanding |
| C3 | Fidelity | every stored value traces to a transcript; zero invented values |
| C4 | Turn count | ≤ 13 turns before the shortlist is shown |
| C5 | Abandonment safety | partial state saved; no fabricated completion |

---

## Part 3 — Three sample outputs

All three are **illustrative samples**, not database records. They use unseeded
phone numbers (`+9100000000 91/92/93`), real locality keys from
`db/demo-snapshot.json`, real experience tags from `role_family.skill_mapping`,
and the real `CFG-BFSI-RE-1` gates. No seeded candidate has been altered.

---

### Sample A — clean run, Marathi, QR-attributed → qualified

**Onboarding Record**

```json
{
  "record": "ONB-SAMPLE-A",
  "phone": "+910000000091",
  "language": "mr",
  "attribution": { "method": "QR", "siteId": "SITE-001", "partnerId": "PAR-001" },
  "sitting1": {
    "elapsed": "2:38",
    "turns": 11,
    "readbacks": 2,
    "captured": {
      "name":              { "value": "Sunita Shinde",                      "said": "माझं नाव सुनीता शिंदे आहे",   "confidence": 0.91 },
      "localityKey":       { "value": "kothrud",                            "said": "माझं घर कोथरूड आहे",          "confidence": 0.88 },
      "experienceMonths":  { "value": 24,                                   "said": "मला दोन वर्षांचा अनुभव आहे",   "confidence": 0.94 },
      "experienceTags":    { "value": ["FIELD_SALES","CUSTOMER_SERVICE"],   "said": "फील्ड सेल्स आणि कस्टमर सर्विस","confidence": 0.86 },
      "expectedPayPaise":  { "value": 2000000,                              "said": "वीस हजार",                    "confidence": 0.69, "readBack": true, "confirmed": true },
      "maxCommuteMin":     { "value": 45,                                   "said": "पंचेचाळीस मिनिटे",             "confidence": 0.71, "readBack": true, "confirmed": true },
      "shiftAvailability": { "value": ["ANY"],                              "said": "कोणतीही शिफ्ट",                "confidence": 0.93 },
      "languages":         { "value": ["mr","hi"],                          "source": "language picker + spoken",  "confidence": 1.00 }
    },
    "declarations": { "age18": true, "workAuthorised": true, "source": "checkbox, not inferred" },
    "consent": { "PROCESSING": "granted", "JOB_ALERTS": "granted", "VOICE_SCREENING": "not asked" }
  },
  "stageA": { "pass": true, "reasons": [] },
  "stageB": { "pass": false, "reasons": ["NO_APPLICATION","ASSESSMENT_NOT_TAKEN","INTEREST_NOT_RECONFIRMED"] },
  "shortlistShownAt": "2:38",
  "shortlist": [
    { "jobId": "JOB-001", "title": "Relationship Executive", "commute": "CLOSE", "payFit": "expected ₹20,000 ≤ fixed ₹18,000 + variable ₹7,000" },
    { "jobId": "JOB-002", "title": "Customer Service Associate", "commute": "MODERATE", "payFit": "expected ₹20,000 = fixed ₹20,000" }
  ],
  "sitting2": { "status": "QUEUED", "trigger": "WhatsApp alert on JOB-001 match", "estimated": "2:00" }
}
```

**Critic scorecard**

| Criterion | Result | Note |
|---|---|---|
| C1 time to shortlist | **PASS** | 2:38, under the 2:45 target |
| C2 Stage A | **PASS** | no outstanding reasons |
| C3 fidelity | **PASS** | 8/8 values trace to a transcript; 2 low-confidence values read back before storing |
| C4 turns | **PASS** | 11 turns |
| C5 abandonment | **PASS** | n/a, completed |

**Verdict: PASS — no rework.**

---

### Sample B — poor recognition, Hindi, typed fallback → still lands inside the cap

**Onboarding Record**

```json
{
  "record": "ONB-SAMPLE-B",
  "phone": "+910000000092",
  "language": "hi",
  "attribution": { "method": "PARTNER_CODE", "code": "DCS101", "siteId": "SITE-001", "partnerId": "PAR-001" },
  "sitting1": {
    "elapsed": "3:52",
    "turns": 13,
    "readbacks": 5,
    "retries": 2,
    "captured": {
      "name":              { "value": "Imran Qureshi",                    "said": "मेरा नाम इमरान कुरैशी है",  "confidence": 0.83 },
      "localityKey":       { "value": "hadapsar",                          "said": "हड़पसर",                    "confidence": 0.77 },
      "experienceMonths":  { "value": 8,                                   "said": "आठ महीने",                  "confidence": 0.65, "readBack": true, "confirmed": true },
      "experienceTags":    { "value": ["CUSTOMER_SERVICE"],                "said": "कस्टमर सर्विस",              "confidence": 0.74 },
      "expectedPayPaise":  { "value": 2200000,                             "said": "बाईस हज़ार",                 "confidence": 0.41, "readBack": true, "corrected": true,
                             "correctionTrail": [
                               { "heard": "बीस हज़ार",   "storedCandidate": 2000000, "candidateSaid": "नहीं, फिर से" },
                               { "heard": "बाईस हज़ार",  "storedCandidate": 2200000, "candidateSaid": "हाँ, सही है" }
                             ]},
      "maxCommuteMin":     { "value": 30,                                  "said": "तीस मिनट",                   "confidence": 0.81 },
      "shiftAvailability": { "value": null,                                "said": "(unintelligible ×2)",        "confidence": 0.00,
                             "resolution": "switched to typed input after 2 failed attempts; candidate selected ANY",
                             "finalValue": ["ANY"], "finalSource": "typed" },
      "languages":         { "value": ["hi","mr"], "source": "language picker + spoken", "confidence": 1.00 }
    },
    "declarations": { "age18": true, "workAuthorised": true },
    "consent": { "PROCESSING": "granted", "JOB_ALERTS": "declined", "VOICE_SCREENING": "not asked" }
  },
  "stageAByJob": {
    "JOB-001": { "pass": true, "reasons": [],
                 "note": "expected ₹22,000 ≤ fixed ₹18,000 + variable ₹7,000 = ₹25,000 — clears, but only through variable pay, so a SALARY_GAP is surfaced" },
    "JOB-002": { "pass": true, "reasons": [],
                 "note": "expected ₹22,000 ≤ fixed ₹20,000 + variable ₹3,000 = ₹23,000 — clears narrowly" }
  },
  "stageB": { "pass": false, "reasons": ["NO_APPLICATION","ASSESSMENT_NOT_TAKEN","INTEREST_NOT_RECONFIRMED"] },
  "shortlistShownAt": "3:52",
  "shortlist": [
    { "jobId": "JOB-001", "title": "Relationship Executive", "commute": "MODERATE",
      "payFit": "expected ₹22,000 needs variable pay — SALARY_GAP surfaced, not hidden",
      "gap": "8 months experience vs 6 month minimum — clears, but scores 67/100 on experience" }
  ],
  "sitting2": { "status": "QUEUED", "trigger": "WhatsApp alert on JOB-001 match", "estimated": "2:00" },
  "flags": ["JOB_ALERTS consent declined — sitting 2 cannot be triggered by alert; must be triggered on next inbound visit"]
}
```

**Critic scorecard**

| Criterion | Result | Note |
|---|---|---|
| C1 time to shortlist | **PASS (marginal)** | 3:52, inside the 4:00 cap but 67 s over target |
| C2 Stage A | **PASS** | clears against both live jobs |
| C3 fidelity | **PASS** | the ₹20,000 → ₹22,000 correction is stored as a trail, not an overwrite; the unintelligible shift answer was never guessed |
| C4 turns | **FAIL** | 13 turns vs the 13 ceiling — at the limit, and 2 were pure retries |
| C5 abandonment | **PASS** | n/a |

**Verdict: REWORK.** Critic's instruction back to the onboarder: *"Shift
availability burned 2 voice turns and 41 seconds for a 3-option answer. Present
shift as tappable buttons from the first ask instead of voice-first. Expected
saving ~35 s, brings the run to ~3:17."*

Round 2 result: **3:19, 12 turns → PASS.**

---

### Sample C — abandonment at expected pay

**Onboarding Record**

```json
{
  "record": "ONB-SAMPLE-C",
  "phone": "+910000000093",
  "language": "en",
  "attribution": { "method": "DIRECT", "siteId": null, "partnerId": null },
  "sitting1": {
    "elapsed": "1:47",
    "status": "ABANDONED",
    "abandonedAt": { "turn": 7, "field": "expectedPay", "lastActivity": "1:47", "idleBeforeExit": "62 s" },
    "turns": 6,
    "captured": {
      "name":             { "value": "Priya Kulkarni",                  "said": "My name is Priya Kulkarni",     "confidence": 0.95 },
      "localityKey":      { "value": "baner",                           "said": "I live in Baner",               "confidence": 0.92 },
      "experienceMonths": { "value": 0,                                 "said": "I have no experience",          "confidence": 0.89 },
      "experienceTags":   { "value": [],                                "said": "I have not worked before",      "confidence": 0.84 },
      "expectedPayPaise": { "value": null,                              "said": null,
                            "note": "question asked and spoken aloud; no answer received; NOT inferred" }
    },
    "declarations": { "age18": true, "workAuthorised": null },
    "consent": { "PROCESSING": "granted", "JOB_ALERTS": "granted", "VOICE_SCREENING": "not asked" }
  },
  "persisted": {
    "candidateStatus": "REGISTERED",
    "note": "status deliberately NOT set to PROFILE_ACTIVE — completeProfile was not called. Partial answers held against the phone number for resume.",
    "resumeAt": "expectedPay",
    "resumeWindowDays": 30
  },
  "stageA": { "pass": false, "reasons": ["SALARY_INCOMPATIBLE — cannot evaluate, expected pay absent"] },
  "stageB": { "pass": false, "reasons": ["PROFILE_INCOMPLETE","WORK_AUTHORISATION_REQUIRED","NO_APPLICATION","ASSESSMENT_NOT_TAKEN","INTEREST_NOT_RECONFIRMED"] },
  "shortlistShownAt": null,
  "dropOffAnalysis": {
    "hypothesis": "Expected pay is the first question with a wrong answer. Name, locality and experience are facts; pay is a negotiation the applicant fears getting wrong.",
    "evidence": "62 s idle on a question that averages 17 s elsewhere in this sample set — the longest idle of the three.",
    "confidence": "LOW — one sample. Not a finding.",
    "proposedChange": "Offer three tappable bands (₹15–18k / ₹18–22k / ₹22k+) alongside the voice option, and say aloud that it can be changed later.",
    "status": "PROPOSAL ONLY — not applied. Changing the question set is Teena's decision."
  }
}
```

**Critic scorecard**

| Criterion | Result | Note |
|---|---|---|
| C1 time to shortlist | **N/A** | no shortlist reached |
| C2 Stage A | **FAIL (expected)** | abandoned, correctly recorded as incomplete |
| C3 fidelity | **PASS** | expected pay left `null`. Nothing inferred from an absent answer. `workAuthorised` left `null`, not defaulted to false-and-forgotten |
| C4 turns | **PASS** | 6 turns before exit |
| C5 abandonment safety | **PASS** | partial state persisted, resume point recorded, status left `REGISTERED`, `completeProfile` not called |

**Verdict: PASS.** The run failed; the agent did not. C5 is the criterion that
matters here, and the correct behaviour on abandonment is to record it honestly
and stop — not to fill gaps so the record looks complete.

---

## Part 4 — What is missing, and what I need from you

### Blocking — I cannot write CLAUDE.md without these

1. **Is the agent allowed to change the journey, or only to run and report on it?**
   Sample C's proposed pay-band change is a code change to
   `src/app/wa/voice-journey.tsx`. Your rule "nothing that is not part of its
   job" makes this ambiguous. Three readings: (a) run journeys and report only;
   (b) propose changes, you apply them; (c) apply changes to the journey code
   and open a PR. I would pick (b).

2. **Where do the applicants come from?** There is no real applicant data here —
   the eight seeded candidates are `DEMO`-prefixed fixtures. Does the agent
   (a) simulate applicants to test the journey, (b) onboard real people through
   the live `/wa` journey, or (c) both? This determines whether Chrome and Apify
   are even the right tools.

3. **What is Apify actually for?** I can see no scraping need in an onboarding
   journey. Best guess: pulling candidate leads from job boards or Facebook
   groups to invite into the journey. If so, that is a separate job with its own
   consent problem — a scraped phone number has granted no `PROCESSING` consent,
   and `startScreening` would correctly refuse it. Tell me the intent and I will
   scope it properly; if there is none, I will leave Apify out.

4. **Is there any real drop-off data anywhere?** Analytics, a previous pilot, a
   WhatsApp export, a spreadsheet. My 2:45 target is derived from your code, not
   measured from your users. One real cohort would move it from "well-grounded
   estimate" to "known".

### Non-blocking — I will assume the following unless you say otherwise

5. **Roles in scope:** `CFG-BFSI-RE-1` and `CFG-BFSI-CSA-1` only. Retail Sales
   Associate stays a sandbox config.
6. **Languages:** en / hi / mr, as the journey already supports.
7. **Interpreter:** Gemini free tier where `GEMINI_API_KEY` is set, rule-based
   otherwise. Never a paid call without asking.
8. **Voice screening consent:** the agent never grants `VOICE_SCREENING` on the
   applicant's behalf and never starts a Raya call — browser provider only.
9. **Money:** integer paise everywhere, per the repo rule. The agent reads
   ledgers but never writes one.
10. **Stop rule:** 3 critic rounds, then report failure. Never declare a pass
    the critic did not give.
