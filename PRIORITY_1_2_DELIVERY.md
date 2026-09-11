# Priority 1 and 2 — implementation notes

This update requires migration 008_demo_workflows.sql. Apply with npm run db:migrate, then deploy. No reset or reseed is required. External messaging, payments, OTP and documents remain simulated.

## Demo routes

- Operations → Partners → View sites: selected partner only, read-only site details and expandable Edit. Add site is separate.
- Partner → QR sites: list of own sites; click View QR & link for that site's QR, copy link or download.
- Operations → Candidates / Candidate referrals → candidate: profile, education, skills, role attributes, assessment results, consent and applications.
- Candidate → My profile: saved details/checklist; edit profile/role/preferences; return after verification to review captured data.
- Operations → Job matches: scored suggestions, reasons, eligibility, application/reconfirmation, unlock and partner; rerun, review manually, hide/restore suggestions with reasons. Manual review never bypasses eligibility or consent. Removing a suggestion does not reverse a paid unlock.
- Candidate → Suggested jobs: apply and explicitly confirm sharing; not interested; tomorrow reminder. New profile/assessment changes and job approval start matching after the response; failures appear in Exceptions for retry.
- Candidate → My applications: current stage, outcomes and per-application withdrawal.
- Employer → Job → Unlocked profiles: Select for this job, shortlist and other outcomes; unlocked preview links to the action section.
- Operations → Jobs: return pending job with a reason; employer edits returned draft and resubmits.
- Employer → New job: description, preferred skills, qualification, work mode, closing date and draft option. Pay is fixed plus maximum variable.
- Employer / Partner → My organisation: edit permitted display/contact information; Operations retains legal/verification controls.
- Operations dashboard: placement metrics; employer dashboard removes hard-coded persona and repeated credit queries.
- Employer → Job: request credits; My credit requests shows decisions. Operations → Credit requests records an approved simulated purchase exactly once.
- Operations → Exceptions: failed verification/matching/messages, incomplete tests/registrations, referral/fraud links. Failed-message retry updates simulated delivery only.
- Demo reminders run when the administrator advances the demo clock or Operations chooses Deliver due demo reminders. They respect alert consent, quiet hours and weekly cap. No external scheduler is connected.

## Validation

Validation completed: migration 008 applied to a disposable local PostgreSQL database; production build/type checking passed; 78 existing acceptance checks passed; new database-backed workflow tests passed; 22 role-specific local HTTP route checks passed. Hosted Vercel behaviour and visual browser interaction were not verified. New database-backed workflow tests are in scripts/priority12-test.cjs and require a disposable seeded database; they change test records. Existing acceptance tests must also run only against disposable data.
