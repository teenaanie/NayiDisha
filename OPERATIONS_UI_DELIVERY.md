# Operations UI redesign

Implemented the supplied visual reference in the Operations workspace: light blue sidebar, page search, pastel placement metrics, candidate funnel, job status chart, recent employers, attention queues, quick actions, and responsive layouts. All existing Operations routes remain accessible. Existing role authorization is preserved.

New screens:
- `/ops/applications`: candidate/job/ID search and application status filtering.
- `/ops/reports`: all-time metrics, print view, and authenticated CSV download.

Metric definitions intentionally reflect stored data rather than the illustrative screenshot: the funnel uses distinct candidates; job status includes every database status; referral rewards are non-reversed accruals, not a claim of completed payouts. All dates use the demo clock. Search finds workspace pages.

Validation:
- `npm run build`: passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- `scripts/ui-smoke.ts`: eight page/filter checks, CSV response and totals, anonymous and employer export denial passed against the current demo fixture.
- Browser checks: 1600px desktop, 390px mobile, page search, mobile menu, application filtering.

To repeat read-only smoke checks, start the local server and run `node --import tsx --env-file-if-exists=.env.local scripts/ui-smoke.ts` with the same session secret/password as that server. The count assertions reflect the current demo fixture (10 candidates, one joined application, INR 75 accrued rewards).

No database reset, mutation acceptance suite, or deployment was performed. Employer, Partner, Finance and WhatsApp workflows retain their existing designs; this delivery covers the supplied Operations reference and its linked Operations screens.
