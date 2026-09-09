# Navigation, action placement and responsiveness review

Reviewed against commit 40b8a44 after the reported deployment to aaspassjobs.vercel.app.

## Corrected

| Area | Finding | Change |
|---|---|---|
| Operations / Employers | Global Edit employers button did not identify an employer; sent users to the entire catalogue. | Each employer row has Edit, opening a dedicated editor with that record’s details and a return link. |
| Operations / Partners | Same global editing problem, including site creation. | Each partner row has Edit / sites; the page contains that partner and its sites only. |
| Operations / Sites | Site maintenance required finding the record again in the catalogue. | Each site row links to its own site section on its partner’s editor. |
| Site editing | The old catalogue locality selector defaulted to its first option, rather than the site's current locality. | Preserve the existing locality in both editors. |
| Add employer / Add partner | No immediate click feedback while the next page loaded. | Buttons show Opening… while navigation is pending. Added loading boundaries for each role area. |
| Creation forms | Artificial delays before returning to the general dashboard. | Saving feedback and immediate navigation to the relevant employer, partner or job list. Cancel returns to the originating list. |
| Shared page layout | The clock database read blocked the entire page shell. | Stream the clock independently; navigation and loading UI can render without waiting for it. Removed advice to reset the database on a connection error. |
| Navigation | Shared menus could prefetch additional pages against a small connection pool. | Disable automatic prefetch on the shared role/tab menus. |
| Employer Jobs | One additional balance query per job. | Fetch all of the employer's balance totals in one grouped query. |
| Employer Billing | Three balance/reconciliation queries per entitlement, despite already loading its ledger. | Reuse the loaded ledger and fetch confirmation counts together. Preserve the calculation rules. |
| Save refresh | Each action invalidated the root and six descendant layouts redundantly. | Invalidate the root layout once, which already covers its descendants. |
| Candidate navigation | Administrator-selected candidate could change when switching tabs. | Carry the candidate selection across applicable candidate tabs. |
| Operations configuration | Administrator-only controls were shown as usable to Operations users. | Disable those controls with an explanation; hide the administrator-only sandbox editor. |
| Record actions | Some Operations/job actions lacked error feedback. | Show saving/result/error feedback at the record. |

## Verification

TypeScript check and production build passed. Credit-summary tests cover included credits, purchases, unlocks, replacement restores, expiry, empty ledgers and deficits.

Live browser testing is blocked because the browser tool cannot verify its administrator-enforced policy. No live timing measurements or Vercel logs were available, so these changes do not establish that the deployed slowdown is fully resolved. The Add employer route exists and targets the intended form; its reported live stall remains unverified.

## Deploy and check

No database migration or new dependency is required for this update. Commit the changed and new source files, push and redeploy, then refresh the browser.

Check Employers → Add employer; Cancel back to Employers; Edit two different employers and verify their identities; edit a partner/site and confirm its locality; check Jobs and Billing responsiveness.

If the application still takes an unusually long time to open those pages, inspect Vercel function logs for the specific request’s duration and database errors, and confirm the function/database regions and database connection availability. Those deployment conditions cannot be determined from source code alone.
