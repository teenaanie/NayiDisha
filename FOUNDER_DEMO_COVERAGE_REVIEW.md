# Founder demo coverage review — 10 September 2026

Scope: checked the supplied founder-demo checklist against the local NayiDisha source. “Implemented” below means a screen and supporting code exist; it does not mean this deployment has passed a live end-to-end test. Browser access remains blocked, and database migrations/deployed data were not verified in this review. The pasted document is a checklist, not evidence of implementation. Only terminology changes were made; gaps below remain open.

## Terminology

Renamed the Operations menu and heading **Attribution → Candidate referrals**, the dashboard item to **Referral disputes**, and the partner table column to **Referral status**. Existing routes and stored records remain compatible.

Matching means “which jobs suit this candidate?” Referral attribution means “which partner introduced this candidate and may earn a reward?” The existing referral screen contains no candidate–job scores. A separate **Job matches** screen is needed for the proposed demonstration.

## Priorities

| Priority | Work | Reason / completion criteria |
|---|---|---|
| P0 — before claiming a reliable demo | Verify deployed end-to-end flow and loading | Run migration 007 if pending; test a new employer, partner, referred candidate, job, application, unlock and reward on the deployed database. Loading has been reported repeatedly; source/build checks alone cannot establish deployed reliability. |
| P1 — core story | Connect candidate completion to job discovery | Completing a profile/assessment should evaluate relevant existing live jobs and offer eligible notifications. Today approval dispatches alerts; the candidate-completion path does not dispatch existing-job alerts. Separate alert eligibility from full qualification. |
| P1 — core story | Operations Candidates and Job matches screens | Provide profiles, skills, assessment scores, referral source, job score/reasons, consent, application and unlock status in connected views. Currently these are scattered or absent from Operations. |
| P1 — broken control | Correct Re-run matching placement/permission | Button appears on employer job details but authorization only permits Operations/Admin; Operations cannot open that employer page. Expose an Operations action on Job matches; do not grant unrelated access. |
| P1 — complete the lifecycle | Candidate My applications and per-job withdrawal | Show every application and its current stage, with a clear withdrawal action. Inbox shows alerts/interviews/offers and pending reconfirmations; global consent withdrawal is not a per-application action. |
| P1 — moderation | Reject / return job with a reason | Approval exists; the Operations job control has no rejection/return action. Employer should see the reason and be able to correct/resubmit. |
| P2 — completeness | Operations summary metrics | Add candidate totals, assessed/awaiting assessment, closed jobs, matches, pending consent, confirmed applications, unlocks and referral rewards. Current dashboard is mainly exception queues. |
| P2 — self-service | Employer/partner profile editing | Operations editors exist. An employer cannot edit its organisation profile through its own dashboard; partner self-service details are also limited. |
| P2 — posting completeness | Complete job fields and draft lifecycle | Add description, preferred skills, work mode, explicit qualification where relevant, user-selected closing date and save-as-draft. Existing form supports core role, branch, languages, experience, required skills, pay and vacancies. |
| P2 — candidate clarity | Assessment/progress, reminders and partner status | Show retained assessment results/profile completeness, partner candidate assessment/pending-action status, and candidate Remind me later with an actual scheduled reminder. |
| P2 — finance/operations | Credit request approval and exception handling | Demo purchase and ledgers exist; credit request/approval workflow and consolidated OTP/test/message exception queue do not. |
| P2 — audit clarity | Joined consent and recruitment timeline | Expose job-specific application/reconfirmation and stage changes, not just separate consent records and outcomes. Add a distinct shortlist step if desired. |
| P3 — after demo acceptance | Real service integrations | Real mobile verification, invitation delivery, WhatsApp delivery status, document storage and payments remain outside the agreed isolated-demo scope. |

## Checklist coverage

### Operator journey

| Requested point | Coverage | Evidence / gap |
|---|---|---|
| Employer/partner totals; active and pending jobs | Implemented, partial dashboard | `src/app/ops/page.tsx` counts these, mostly in exception tiles. |
| Closed jobs; candidate/assessment totals | Missing from dashboard | No matching dashboard counters. |
| Matches, consent pending, confirmed applications, unlocks, referral credits | Missing from dashboard | Underlying records exist in different modules, but no requested placement funnel summary. |
| Add employer and provide login | Demo implemented, contact assignment partial | Employer creation plus verified-row invitation; recipient chooses password. Login ID is organisation ID, not a named contact/email account. No automatic sending. |
| Add partner, QR/referral link | Demo implemented | Partner creation, sites and QR pages; partner/site source retained in registration. |
| Review and approve employer jobs | Implemented | `ops/jobs/page.tsx`, `ops-client.tsx`, `actApproveJob`. |
| Open Candidates: profiles, skills, scores, source | Missing as Operations screen | No `/ops/candidates` route. Partner list is limited; candidate self-service does not replace an Operations directory. |
| Open Matches with score/reasons/consent/unlock/partner | Missing as combined screen | Referral screen only joins candidate/source and unlock counts. Employer job details show qualified scores/reasons. |
| Re-run / remove / manually add match | Partial, permission mismatch | `employer/job/[id]/job-tools.tsx` exposes re-run; `lib/auth.ts` permits Operations/Admin only. No manual-match or removal UI found. Re-run evaluates existing applications only. |

### Employer journey

| Requested point | Coverage | Evidence / gap |
| Log in newly created employer | Demo implemented | Invitation on approved row → password → `/employer`; `/sign-in` supports return/reset. Requires migration 007. |
| Employer profile and edit | Partial | Dashboard shows brand/status; organisation editing is under Operations. No employer profile editor. |
| Role, location, experience, required skills, vacancies | Implemented | `employer/new-job/form.tsx`; configurable role/job attributes also supported. |
| Description, preferred skills, work mode, qualification | Partial/missing dedicated fields | No general description/work-mode/preferred-skill inputs in new-job form; role-specific attributes may cover selected qualifications. |
| Salary range | Partial wording difference | Fixed pay plus maximum variable pay, not an independent minimum/maximum salary range. Keep demo wording accurate. |
| Closing date | Partial | Expiry is applied from commercial policy at approval; no closing-date picker in creation. |
| Submit job; pending/live/closed status | Implemented | Creation submits for approval; job list and lifecycle controls exist. |
| Draft and rejected states | Missing user journey | No save-as-draft or job rejection UI. Duplicating a job calls it a draft but creates pending approval. |
| Dashboard active jobs, credits, unlocks | Implemented | Employer dashboard and billing. |
| Confirmed applicants and recommended prospects | Partial | Qualified/reconfirmed applicants are counted. No independent pre-application prospect list. |
| Masked applicants, score/reasons, credit unlock | Implemented | `employer/job/[id]/page.tsx` displays masked qualified previews and explanations. These are qualified applicants, not all probable candidates. |
| Contact/interview/offer/hire/reject | Implemented across screens | Job outcomes and hiring modules, interview scheduling, offers and joining. |
| Explicit shortlist and single stage board | Partial | No distinct shortlist control located; stages spread across job details, hiring and outcomes. |

### Partner journey

| Requested point | Coverage | Evidence / gap |
| Login/details/QR/referral link | Demo implemented | Invitation/sign-in, partner dashboard/sites. Profile self-edit is limited. |
| Own referred candidates and allowed information only | Implemented in code | `partner/candidates/page.tsx` scopes by partner and requires assistance consent; names/contact masked. |
| Registration, assessment, application and pending-action status per candidate | Partial | Applications, qualified matches, unlocks and referral status shown. Assessment score/completion and a clear pending-action column absent. |
| Nudge candidate | Demo implemented | Partner nudge controls and consent/frequency rules. |
| Pending/confirmed referral credits | Implemented | Partner rewards and finance/reward ledger pages. Reward is tied to qualifying unlock, not mere registration or hiring. |

### Candidate journey

| Requested point | Coverage | Evidence / gap |
| Scan QR, retain partner source | Demo implemented | `/j/[code]`, candidate registration and verification binding. |
| Mobile OTP | Simulated | Synthetic mobile and fixed 123456; no real mobile ownership verification. |
| Terms/data use/profile sharing consent | Partial | Processing, alerts and assistance choices plus job reconfirmation exist; no separate terms-acceptance/version screen located. |
| Profile/locality/experience/skills | Implemented | WhatsApp simulator profile form. Education is role-attribute dependent, not a standard general education field. |
| Initial assessment | Demo implemented | Server-checked timed assessment sessions. |
| Score and profile completion | Partial | Score shown after submission; no clear persistent completion percentage/history panel. |
| Receive job matches | Partial | Approval dispatches language/commute-filtered alerts, not the full assessment/skill scoring pipeline. WhatsApp Available jobs lists live jobs generally. |
| Apply / Not interested | Implemented, split screens | Apply in simulator and alerts; Not interested in inbox. |
| Remind me later | Missing | No reminder choice/scheduling found. “Not now” on reconfirmation leaves the application on hold; it schedules nothing. |
| Returning web sign-in and profile correction | Demo implemented | `/sign-in` opens the same candidate through synthetic mobile/OTP; profile/preferences editing exists. |
| View all applications/statuses | Partial | Inbox shows reconfirmations, alerts, interviews and offers, but no complete applications list/timeline. |

### Additional safeguards and operational areas

| Requested point | Coverage | Evidence / gap |
| Job approval/rejection | Partial | Approval implemented; rejection absent. |
| Match explanation | Implemented for employer; missing Operations view | Employer score, explanations/gaps and input snapshot. |
| Candidate consent history | Partial | Rights page shows purpose-level consent; applications save consent snapshot and reconfirmation timestamp. No unified per-job sharing history UI. |
| Credit request and approval | Missing | Demo Buy credits exists; no request → approver workflow. |
| Credit/referral ledgers | Implemented | Employer billing, partner rewards, finance ledger/payouts and replacement handling. |
| Recruitment stages | Implemented, partial presentation | Contact, interviews, offers, joining/rejection; shortlist/combined timeline missing. |
| Notification log | Partial/demo | Candidate message log and simulated messaging provider; not real WhatsApp delivery confirmation or a central failure/retry console. |
| Duplicate candidates | Implemented in code | Registration reuses existing phone record. This is demo identity logic, not real OTP assurance. |
| Referral rule/expiry/override | Implemented with limits | First verified registration, window, review/void and correction workflow. Do not describe this as “latest referral wins.” |
| Job closure/expiry | Implemented with presentation limits | Close/pause controls, expiry filtering and clock-driven expiry handling; creation date picker absent. |
| Candidate withdrawal | Partial | Consent withdrawal exists; no clear per-job application withdrawal UI. |
| Role permissions | Implemented, requires regression testing | Role/entity scope and account-version/suspension checks; re-run matching mismatch identified above. |
| Audit trail | Implemented, coverage not exhaustively proven | Explorer combines `action_audit` and `audit_log`. Do not promise every possible action has full before/after details. |
| Operational exception queue | Partial | Fraud, referral disputes, replacements and data requests exist. Failed OTPs, incomplete tests and message retries are not consolidated. |

## Additional code findings relevant to the demo

- Employer dashboard still sums credit balances one entitlement at a time (`src/app/employer/page.tsx`). This is a remaining latency risk as job count grows; it is not a proven diagnosis of the live slowdown.
- Employer dashboard identifies the user as “DEMO Asha Kulkarni” even for a newly invited employer. Replace the hard-coded persona with actual account context before showing founders new-account onboarding.
- Preserve the distinction between a successful build and a tested placement. Existing service mocks and source checks do not verify the current hosted database, every permission path or real delivery.

## Safe demonstration sequence with today’s implementation

1. Create and approve employer/partner; manually create their simulated invitations.
2. Create the employer job, then explicitly approve it in Operations.
3. Register candidate through the partner QR, verify simulated OTP, consent, complete profile and assessment.
4. Open available jobs, apply and reconfirm. Do not claim a newly completed assessment automatically sent an existing-job notification.
5. Open the employer’s job: show masked qualified applicant, explanation and credit-based unlock.
6. Show partner reward entry, interview, offer and joining.
7. Use Candidate referrals to explain the sourcing partner. Call out missing screens rather than presenting referral attribution as job matching.
