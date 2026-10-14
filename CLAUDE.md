# NayiDisha: working notes for Claude Code

## Before every PR (owner's request, 14 Oct 2026)
Run all three and report the results; never open a PR or publish with a failure:

```bash
npm run test:e2e
```
Browser tests (Playwright, Chromium). Starts the app on port 3201 against a fresh LOCAL database
(`frontline_e2e`, its own Postgres in `.e2e/`, started automatically) with the offline mock AI.
`e2e/prepare.ts` refuses any database that is not on this machine.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5544/frontline_t RP_PROVIDER=mock RP_LOG_METRICS=0 npx tsx scripts/roleplay-tests.ts
```
Practice coach unit + integration tests (recreate `frontline_t` first if a scenario version clash appears).

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5544/frontline_t npx tsx --env-file-if-exists=.env.local scripts/acceptance.ts
```
Job portal acceptance tests (run `npm run -s db:seed` with the same DATABASE_URL first).

Add or extend a Playwright test in `e2e/` for any change a user can see in the browser.

## Never against production
`.env.local` points at the live Supabase database. Tests, migrations and seeds run against the
local Postgres only, unless the owner approves a specific production step.

## Releasing
Merge → wait until the Vercel production deployment of the merge commit is READY (trigger it via
the API if the merge did not) → only then `npm run -s rp:seed` for scenario changes.
