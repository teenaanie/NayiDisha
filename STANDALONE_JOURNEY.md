# Standalone candidate journey — what was built

The applicant journey now runs on its own at **`/apply`**, with role-specific
questions scored against a written rubric. The founder demo at `/wa` is
unchanged and still passes its acceptance suite.

## Demo it

```bash
npm run dev
```

| Open | What it shows |
|---|---|
| `/apply` | Direct entry. No sidebar, no role switcher, no demo clock banner. |
| `/apply?code=DCS101` | Partner-code entry. |
| `/apply/q/qr_DCS101_7K2QX` | Printed-QR entry — redirects to `/apply?code=…`. |

Register with an **unseeded** number (`+910000000091` upward; `…0001`–`…0010`
are existing candidates). OTP is `123456`.

The payoff is picking two different roles and seeing genuinely different
questions:

| Role | Job | Asks about |
|---|---|---|
| Relationship Executive (v2.0) | JOB-101, DEMO Sahyadri Bank | field-sales comfort, CASA familiarity, two-wheeler · then customer objections, a bribe offer, deposit arithmetic, target pressure |
| Delivery Rider | JOB-102, DEMO Pune Quick Logistics | two-wheeler, licence, phone navigation · then an unmarked address, COD change, riding in heavy rain, route planning |

Three of the four skill questions are drawn per run, so two runs of the same
role differ.

## How a role gets its own script

`app.role_script` is versioned per role configuration, like an assessment
template. Two kinds of turn:

- **ATTRIBUTE** — interpreted into `candidate_attribute_value`, the same place
  the typed profile form writes, which is what matching Stage B reads.
- **SKILL** — an open spoken answer scored against a rubric carried in the
  script, so a score stays readable after the script moves on.

A configuration with `role_script_id` set runs its script instead of the
multiple-choice step. A configuration without one is completely unaffected.

## Scoring, and how far to trust it

`src/modules/adapters/scoring.ts` picks Gemini 2.5 Flash when `GEMINI_API_KEY`
is set, Claude when `ANTHROPIC_API_KEY` is, and a keyword matcher otherwise.

**The keyword fallback is weak on purpose and says so.** It cannot tell "I would
refuse the money" from "I would not refuse the money", so its confidence is
capped at 0.5 and every answer it scores is flagged `needs_review`. Operations
sees those flags on the candidate record under **Skill answers**, alongside the
verbatim transcript, the rubric credits awarded, the scorer and its reasoning.

**Flagged scores do not block qualification.** That is deliberate — otherwise
the journey dead-ends whenever no model is reachable — but it means a
keyword-scored candidate can qualify. Worth revisiting before real applicants.

No model key was set when this was built, so the Gemini and Claude paths compile
and fall back correctly but have not been exercised against a live model.

## Where the score goes

Stage B gates on it (`SKILL_SCRIPT_NOT_TAKEN`, `SKILL_BELOW_<n>` rather than the
multiple-choice reasons) and Stage C ranks on it. The stored match inputs record
`{source: 'SCRIPT', scriptVersion}` so an explanation still reproduces later, per
MATCH-06.

The two new configurations weight it at **20**, against the multiple-choice 5,
because a rubric-scored conversation is a real signal. Weights still total 100.

## Fixes made along the way

1. **`field_sales_comfort` was unsubmittable.** Declared `ENUM` with an empty
   `allowed_values` while `CFG-BFSI-RE-1` marked it required — `saveProfile`
   demanded a value then rejected every value. The Relationship Executive
   profile step could not be completed. Both BFSI enums now carry real values.
2. **The in-app demo reset was broken.** `resetDemo` did a bare `TRUNCATE`, but
   six tables added in migrations 008/010/011 (`voice_turn`, `screening_call`,
   `job_suggestion`, `candidate_reminder`, `workflow_issue`, `credit_request`)
   hold foreign keys into the snapshot and were never added to it, so Postgres
   refused. Now `TRUNCATE … CASCADE`, and the snapshot has been re-captured with
   all 59 tables.
3. **Two roles rendered as the same option.** The role picker labelled options by
   `role_family_key`, so two published versions of Relationship Executive were
   indistinguishable. It now shows the family's display name, adding the version
   only when it is needed to tell two apart.
4. **`capture-demo.ts` accepts an explicit declaration.** It required a database
   literally named `nayidisha_test`. It now also accepts `ALLOW_DEMO_RESET=true`,
   the flag that already authorises dropping the schema.

## Verification

```bash
ALLOW_DEMO_RESET=true npm run db:reset
npm run test:serverless      # 85 checks, 7 of them for the script path
npx tsx scripts/voice-parse-check.ts   # 31 phrases, proves the voice widening did not regress
```

Use `test:serverless` rather than `test` against Supabase — the session pooler
caps at 15 clients and a running dev server will exhaust it.

After changing the seed, re-capture the snapshot or the in-app reset reverts to
the old dataset:

```bash
ALLOW_DEMO_RESET=true npx tsx --env-file-if-exists=.env.local scripts/capture-demo.ts
```
