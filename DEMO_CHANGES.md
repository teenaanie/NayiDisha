# NayiDisha demo changes — 9 September 2026

The implementation follows the agreed demo scope: simulated WhatsApp and payments, with editable PRD defaults. The original transaction-pool fix is preserved.

## Your testing list

| Finding | Where to use the change |
|---|---|
| Edit employers and partners | Operations → Manage → Employers / Partners. These are Operations permissions; partner identities do not gain access to other organisations. |
| Add service localities | Operations → Manage → Add locality, then select it on the partner record. Multiple service localities can be selected. |
| Extend sourcing capabilities | Add an industry or role in Manage, then select that capability for the partner. |
| New partner approvals | Pending partners show “Approve new partner”; suspended partners use reinstatement. |
| Additional partner sites | Manage → partner → Add site. Each site has its own code and actual scannable QR. Operations verifies and activates it. |
| Attribution and method | The Attribution page explains source binding, QR/code/direct methods, review and correction. Candidate preferences includes a source-correction request. |
| Replacement after payment | A valid approved claim creates a linked reversal. An already-paid reward creates a recovery balance, deducted from future payouts. No bank money is recalled. |
| Where queue entries come from | Applications/unlocks create commercial events; candidates raise rights/source requests; checks create fraud signals; employers raise evidenced replacement claims. Queue pages explain their entry points. |
| Audit logic | The Audit page combines domain events and the signed actor's actions. Editing, approval and financial actions record who acted and when. This remains a demo audit, not a production compliance certification. |
| Additional job roles | Manage → New role → configure fields, weights and translated questions → publish from Configurations. Published configurations are copied into a new version before editing. |
| WhatsApp journey | The browser demo supports registration, explicit consent, profile/role fields, server-scored timed assessment, application and separate reconfirmation. Real Meta integration is intentionally excluded. |

## Other changes

- Signed demo identities with role and record ownership checks; candidate/partner URL selectors no longer switch another user's account.
- Parameterised preference updates and server validation for numbers, choices, job locations and configured fields.
- Fresh unlock eligibility checks; current consent and allowed fields respected when revealing contact data.
- Latest-match selection without duplicate previews; recomputation preserves later hiring states.
- Material job changes await approval and renewed candidate interest. Approval and initial credit grant are atomic.
- Concurrency-safe IDs, credit consumption, reward reservation, payout execution and replacement decisions.
- Paid rewards retain their accrual classification. Statements include withholding, recovery and net amounts.
- Explicit age, work-authorisation and shift collection; interrupted registration resumes from its incomplete step.
- Assessment keys stay on the server; attempts are session-bound, timed and limited. Canonical assessment questions and choices have Hindi and Marathi translations.
- Candidate achievements, endorsement invitations/visibility, individual consent withdrawal and executable access/correction/erasure requests.
- Simulated message/payout failures, retry controls, expiry/reminder/retention processing and guarded atomic seed reset under Demo identities.
- Ordinary migrations are additive and recorded. Reset requires explicit configuration and confirmation.

## Run or upgrade

1. Install the updated dependencies with `npm install`.
2. Configure `DATABASE_URL`, `DEMO_PASSWORD` and a strong `DEMO_SESSION_SECRET` in the deployment environment. The local development fallback password is `demo-admin`; production has no password fallback.
3. Run `npm run db:migrate` against the intended demo database. This applies the additive migrations without reseeding existing records. Back up the existing database before rollout.
4. Build and start the application. Open `/demo` to sign in and select an identity. Open `/wa` for a new synthetic candidate journey; its documented verification code is `123456`.
5. Enable `ALLOW_DEMO_RESET=true` only for a disposable demo. The reset control requires `RESET DEMO` and restores the bundled synthetic dataset, discarding demo edits. A clock reset does not reset data.

Existing profiles may need to provide the newly required work declaration and role fields before qualifying again. New job-detail fields can be included in a new role configuration from Manage.

## Verification and remaining rollout work

- TypeScript check and production build passed during implementation.
- 78 acceptance checks passed with a one-connection pool, including the original hanging scenario.
- 13 additional tests passed for concurrency, payout failure/retry, paid-reward recovery, malformed preferences and executable rights requests.
- Atomic seed reset passed; the acceptance suite also passed against the restored dataset.
- Browser walkthrough is **not verified**: the browser tool refused access because its administrator-enforced policy check was unavailable.
- The shared database and deployed Vercel site have **not** been migrated or redeployed by this task.

The demo processes scheduled work from its controls and simulated clock. Always-on background workers, live WhatsApp delivery/read receipts, actual bank payments, real identity verification, sophisticated device/network fraud detection and production compliance are outside the agreed demo integration scope. Operations can review the implemented source and endorsement signals; a signal is not a finding of fraud.
