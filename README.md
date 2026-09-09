For the September 2026 demo changes and upgrade steps, see [DEMO_CHANGES.md](DEMO_CHANGES.md).

# Multi-Industry Frontline Hiring Platform — Prototype

Working prototype of **PRD v1.3**, Pune BFSI launch configuration.
Everything the PRD marks as an external provider is behind an adapter and resolves to a
simulator, per §21 — so this runs at **zero cost** and reaches nothing and nobody.

---

## Run it locally

Requires Node 20+ and a PostgreSQL 14+ you can connect to.

```bash
npm install
cp .env.example .env.local        # edit DATABASE_URL if your Postgres differs
npm run db:reset                  # create schema + load the canonical §22 dataset
npm run dev                       # http://localhost:3000
```

`npm test` runs the §25 acceptance suite and the §23 backup demo paths — 37 checks,
each named for the clause it protects.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run db:reset` | Rebuild schema and reload the canonical seed |
| `npm run db:migrate` | Schema only |
| `npm run db:seed` | Seed only |
| `npm test` | §25 acceptance suite |
| `npm run build` / `npm start` | Production build and serve |

---

## The 20-minute demo script (§23)

The role switcher across the top is the whole product in one browser.

1. **Configuration (2 min)** — *Operations*. Published BFSI roles and the sandbox Retail
   Sales Associate package. Press **Validate** on any config to see the publication gates.
   Change a weight or threshold in the **sandbox editor** and save: scoring changes with no
   deployment and no migration. That is the framework claim, demonstrated.
2. **Employer (3 min)** — *Employer*. JOB-001 with its ₹2,500 posting entitlement, ten
   included credits, and the credit reconciliation table underneath.
3. **Partner (2 min)** — *Partner*. PAR-001's QR sticker and code, the attributed funnel with
   contact details masked, and an empty reward ledger.
4. **Candidate (5 min)** — *Candidate (WhatsApp)*, or click **Open the candidate journey**
   from a partner's QR so attribution rides along. Register, verify (OTP `123456`), complete
   the profile, take the five-question readiness check, invite an endorsement, apply.
5. **Matching (2 min)** — back to the employer's shortlist. Hard eligibility, weighted score
   components, commute estimate, and explainable gaps against CAN-003 and CAN-004.
6. **Unlock (3 min)** — press **Unlock profile**. Price and revealed fields are shown before
   confirmation. Credit consumed, contact revealed, immutable event written. Press it again:
   no second charge. The partner's ₹75 appears immediately, in hold.
7. **Finance (2 min)** — *Finance*. Advance the demo clock past 72 hours from the Overview
   page, release holds, build the weekly batch. Then look at UNL-002: replacement approved,
   credit restored, reward reversed through a linked row rather than an edit.
8. **Framework proof (1 min)** — *Operations*. The sandbox retail configuration renders
   different fields, assessment and weights through the same application.

### Backup paths, all working

Below-threshold assessment (CAN-006) · consent withdrawal (CAN-007) · duplicate referral ·
suspended partner QR (CAN-008) · expired job (JOB-005) · unlock idempotency · payout reversal.

---

## What is real and what is simulated

| Concern | This prototype | Production |
|---|---|---|
| WhatsApp | Simulator emitting the same normalised events as the Cloud API adapter | Meta Cloud API via a BSP, approved templates |
| OTP / SMS | Any 6 digits accepted (`123456`) | SMS provider |
| Travel time | Seeded Pune locality centroids + haversine + road factor, behind `TravelTimeProvider` | Google Maps or Mapbox |
| Payouts | `SimulatorPayoutProvider`, deterministic | RazorpayX / Cashfree after KYC |
| Documents / KYC | Out of scope (§21.3) | Secure object storage, malware scanning |

Matching, qualification, the credit and reward ledgers, attribution, consent, configuration
versioning and audit are **not** simulated — they are the real domain logic the MVP would ship.

---

## Architecture

A modular monolith, per §24.2. Domain modules under `src/modules` with narrow interfaces:

```
src/modules/
  configuration/   industry, role, attribute, assessment; versioning and publication gates
  candidate/       registration, consent, profile, assessment, endorsement, application
  matching/        Stage A / B / C engine, previews, masking
  commercial/      unlock, credit ledger, reward ledger, replacement, payout, reconciliation
  adapters/        travel, messaging, payout — swapped by environment
src/app/           Next.js App Router: five portals + the WhatsApp simulator
db/migrations/     SQL schema (§12 core data model)
scripts/           migrate, seed, acceptance
```

Rules the code holds to:

- **Money is integer paise, everywhere.** Rupee floats are banned; conversion happens only
  at the display boundary. The acceptance suite fails the build if a money column is not an
  integer type.
- **Ledgers are append-only.** A reversal is a new row linked to the entry it corrects.
  Nothing is ever updated or deleted.
- **The internal ledger is the source of truth.** A payment provider is an execution channel.
- **Every timestamp comes from the demo clock**, never `Date.now()`. That is what makes the
  72-hour hold and the 30-day windows provable in a demo.
- **Attribution is snapshotted onto the unlock event** rather than re-derived at payout time.
- **Match results store their rule version and inputs**, so an explanation reproduces after
  the configuration has moved on.

---

## Deploying (both free tiers, no card)

### Which Supabase connection string

Supabase offers three, and they are not interchangeable:

| String | Port | Use it for |
|---|---|---|
| Direct connection | 5432 | Nothing here — IPv6-only, usually unreachable from a laptop |
| **Session pooler** | 5432 | **Running `db:reset` and `test` from your machine** |
| **Transaction pooler** | 6543 | **The `DATABASE_URL` you give Vercel** |

Both poolers are pgbouncer, which does not support prepared statements — `src/lib/db.ts`
already sets `prepare: false`, so this works, but do not remove that setting.

### 1. Load schema and seed into Supabase

From your machine, using the **session pooler** string:

```bash
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require" npm run db:reset
DATABASE_URL="...same string..." npm test
```

`db:reset` drops and rebuilds the `app` schema, so it is safe to run repeatedly and it does
not matter what was loaded before.

A free Supabase project pauses after about a week idle. Opening the dashboard resumes it —
load the app once before a live demo to confirm it is awake.

### 2. Vercel or Netlify — the app

Push to a Git repository, import it, and set these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **transaction pooler** string, port 6543 |
| `TRAVEL_PROVIDER` | `seeded` |
| `DEMO_PASSWORD` | anything — puts the site behind one HTTP Basic prompt |

`DEMO_PASSWORD` matters on a public URL. The prototype has no user authentication by design
(§21.2 wants a role switcher, not five logins), so without it a stranger with the link can
open the Operations console and approve a payout. All the data is fictional, so the risk is
presentational rather than real, but a demo nobody else can wander into is the better default.

Vercel's Hobby tier is free but its terms restrict commercial use — for a founder demo that
is a judgement call, and Netlify's free tier has no such restriction if you would rather not
make it.

---

## Deviations from the PRD, and why

Three, all small, all because the PRD requires the outcome elsewhere:

1. **Timestamps on every record.** The seed dataset in §22 carries none, but §21.2 requires a
   deterministic demo clock and §16.1 measures a 72-hour hold. Both are impossible without them.
2. **`applications`, `attributions`, `posting_entitlement` and `assessment_attempt` seeded as
   real tables.** §22.7 names APP-001…006 and the demo shows a credit balance; the §12 data
   model has all four entities. They were absent from the seed JSON.
3. **Endorsement points carry two explicit scales.** END-05 sets raw points (manager 10,
   colleague 5) and §22.1 caps the *contribution* at 5. The code names them separately —
   `raw_points` on the endorsement, `endorsement_cap` on the configuration — because a single
   number cannot satisfy END-05, END-07 and §22.1 at once. Worth settling in v1.4.

Everything else follows v1.3 as written, including the decisions I questioned in the review:
partner reward accrues at unlock with no outcome dependency, outcome capture stays optional,
and the configuration framework is built.
