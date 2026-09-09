# NayiDisha — simple demo user flows

A presenter’s guide to the application. “Operator” means Operations, “Employee” is interpreted as Employer, and “Financier” means Finance. There is no separate employee portal; a hired worker continues through the Job Seeker journey.

These flows are based on the current code and bundled sample data. Rehearse them on the deployed demo before presenting; the browser walkthrough has not yet been verified. WhatsApp messages, document uploads and payments are simulated.

## Before the demonstration

1. Ensure the latest code and database migrations have been deployed.
2. Open `/demo`, sign in with the demo administrator password, and choose a role under **Demo identities**.
3. Return to **Demo identities** whenever a flow asks you to switch roles. Clicking a role’s navigation link does not change your signed-in identity. Tabs in the same browser share the selected identity; use a separate browser profile if two roles must stay open simultaneously.
4. Use synthetic names and phone numbers. A new candidate can use `+910000000091`; choose another unused number when repeating the flow. The verification code is `123456`.
5. Keep the demo clock unchanged during registration, hiring and replacement-claim creation. Advance it only during the finance demonstration. Do deletion and reset demonstrations last.

Useful sample records, if the original sample dataset is present:

| Role / record | Example |
|---|---|
| Employer | DEMO Sahyadri Bank — EMP-001 |
| Partner | DEMO CareerSetu Services — PAR-001 |
| Partner code | DCS101 — active site SITE-001 |
| Job | Relationship Executive — JOB-001 |
| Already-unlocked candidate | DEMO Aarav Deshmukh — CAN-001 |
| Another sample candidate | DEMO Imran Khan — CAN-005 |

Existing records may differ after testing. Note the IDs created during your rehearsal. Aarav is already unlocked in the original dataset: use him for interviews, and a new qualifying applicant to demonstrate a new unlock charge.

## The main story — approximately 20–25 minutes

**Operations approves a job → Partner shares a source code → Job Seeker applies and reconfirms → Employer unlocks and interviews → Finance settles the partner reward.**

| Step | Act as | Show in the app | Explain to the audience |
|---|---|---|---|
| 1 | Operations | Employers and Partners: show verified organisations. | “Operations checks who can participate.” |
| 2 | Employer | Jobs: open the live Relationship Executive job. | “The employer publishes the role, location and pay.” |
| 3 | Partner | QR sites: show CareerSetu’s QR and DCS101 code. | “Each source has its own link or code.” |
| 4 | Job Seeker | WhatsApp journey: register with the code, verify, choose consent and complete the profile. | “The candidate chooses how their information is used.” |
| 5 | Job Seeker | Complete the assessment, apply and separately confirm interest. | “An application and confirmed interest are separate steps.” |
| 6 | Employer | Open that job’s shortlist, inspect the match and confirm an unlock. | “A qualified, interested profile consumes one unlock credit.” |
| 7 | Partner | Rewards: show the new attributed reward and its hold. | “The reward is earned on a valid unlock, not on a scan.” |
| 8 | Employer, then Job Seeker | Schedule an interview; switch roles and accept it. | “The candidate confirms the proposed interview.” |
| 9 | Administrator, then Finance | Advance time to clear holds; release holds and build a batch. | “Only eligible earnings meeting the payout minimum are batched.” |
| 10 | Finance, then Operations | Show payout/statement where eligible, then Audit. | “Financial events and operational decisions leave a record.” |

**Finance preparation:** one ₹75 reward does not meet the ₹500 payout minimum. Seven eligible, unreversed ₹75 rewards for the same partner total ₹525. If that balance is not available, demonstrate the below-minimum result. For a short payment demonstration, you may deliberately lower the minimum to ₹75 in Manage & catalogue, clearly label it a demo setting, and restore ₹500 afterwards. Prepare this before presenting; no default has been changed by this guide.

## 1. Operations — onboard and govern the platform

### O1. Add and approve an employer

**Start:** Operations → Employers → Add employer.

1. Enter a synthetic employer name, first branch, locality and administrator name.
2. Click **Create employer**.
3. Return to **Employers**, find the new record and click **Approve**.
4. Open **Manage & catalogue → Employers**, edit a detail, give a reason and save.

**Show:** the employer progresses from pending review to verified; the edited detail persists.

**Say:** “Creating an employer does not automatically verify it. Operations approves it separately.”

### O2. Add and approve a partner

**Start:** Operations → Partners → Add partner.

1. Enter the partner details, locality, languages and sourcing capabilities.
2. Create the partner and return to **Partners**.
3. Click **Approve new partner** on its pending record.
4. Open **Manage & catalogue → Partners & sites** to edit its coverage or capabilities.

**Show:** a new partner is approved as new; reinstatement is for a suspended partner.

### O3. Expand coverage or add a site

**Start:** Operations → Manage & catalogue.

1. Add a locality, including its map coordinates, if it is missing.
2. Open a partner and select its service localities and capabilities; save.
3. Use **Add site** with a name, address and locality.
4. Review the new site and change its status from suspended to active.
5. Switch to that partner and open **QR sites**.

**Show:** the additional site has its own source code and scannable QR.

**Say:** “A partner can operate in multiple areas, with a separate source identity for each site.”

### O4. Approve a submitted job

**Start:** an Employer has submitted a job.

1. Open Operations → **Job moderation**.
2. Find the pending job and review its details.
3. Click **Approve & publish**.
4. Switch back to the employer and open the job.

**Show:** the job is live and its posting credits are available.

### O5. Add a role or change matching settings

**Start:** Operations → **Manage & catalogue**.

1. Add an industry if needed, then a new role based on an existing configuration.
2. Select the candidate/job fields, assessment threshold, ranking weights and document checklist.
3. Add assessment questions with English, Hindi and Marathi wording and choices; save for review.
4. Switch to **Administrator**, open Operations → **Configurations**, validate and publish.
5. Switch to an employer and show the role in **Post a job**.

**Show:** a new role becomes available through configuration. Publishing is an administrator action.

For an existing published role, create a new version before editing. For a short presentation, prepare the questions beforehand and demonstrate only validation/publication.

### O6. Review attribution or fraud

**Start:** Operations → **Attribution** or **Fraud**.

1. Open an existing review item and explain its source or signal.
2. For a source-correction request, inspect the requested partner/site in Fraud.
3. Record the appropriate decision and reason. Use **Approve requested source** only for a valid source-correction request.
4. Revisit Attribution and Audit to show the outcome.

**Say:** “A signal prompts review; it is not proof of fraud.”

Source correction is restricted once an employer has already unlocked the profile. Do this demonstration before the candidate applies/unlocks. A direct registration with no attribution may require Operations assistance rather than the self-service correction form.

### O7. Resolve a candidate’s data request

**Start:** a Job Seeker has submitted a request under My data.

1. Open Operations → **Data requests**.
2. Select an access or correction request.
3. For correction, supply the supported field (`name` or `locality_key`), corrected value and reason.
4. Complete the request, or refuse it with a reason.
5. Switch back to the candidate: download the access export or inspect the corrected information.

**Show:** completing a request performs an action, rather than only changing a label. Demonstrate erasure last on a disposable candidate.

### O8. Explain audit

**Start:** Operations → **Audit**.

1. Filter by the role used in the previous demonstration.
2. Find the approval, edit or financial event.
3. Show the actor, time, entity and available reason/detail.

**Say:** “We can trace the operational decisions and financial events behind the displayed status.”

## 2. Employer — recruit and hire

### E1. Post a job

1. Select a verified employer in **Demo identities**.
2. Open **Jobs → Post a job**.
3. Choose a published role and branch; enter pay, openings, shift, languages and required details.
4. Submit; show that the job awaits approval.
5. Complete O4 as Operations, then return to the employer.

**Show:** a submitted job is not immediately live.

### E2. Review and unlock an applicant

1. Open a live job and inspect its qualified shortlist.
2. Explain the match score, commute, salary gap and other displayed reasons.
3. Choose a qualified, reconfirmed candidate who has not already been unlocked.
4. Review the unlock confirmation and confirm it.
5. Show the revealed contact details and changed credit balance.

**Show:** one new unlock consumes one credit. Reopening the same unlocked profile does not consume another credit. A match score is a ranking aid, not a hiring decision.

### E3. Interview, offer and joining

1. Open **Interviews & onboarding** and select an unlocked candidate.
2. Choose **Schedule interview**, enter a future time relative to the demo clock, location and safety note, then **Send invitation**.
3. Switch to the candidate → **Alerts & messages** → **Yes, I will come**.
4. Return to the employer; record attendance and **Make offer**.
5. Switch to the candidate, accept the offer and use the document **Upload** controls.
6. Return to the employer, review the documents and record joining when the checklist is complete.

**Show:** invitation → candidate confirmation → offer → acceptance → document review → joining. Document uploads are placeholders in this demo.

### E4. Pause or materially change a job

1. Open **Jobs** and pause a live job.
2. Show its paused status; resume it when appropriate.
3. Edit a material term such as salary or shift.
4. Show that approval is required again.
5. After Operations approves, switch to an affected candidate and reconfirm interest through **Alerts & messages**.

**Say:** “Candidates must reconfirm after important terms change.”

### E5. Claim a replacement

1. Within 72 demo-clock hours of an unlock, open its post-unlock controls.
2. Choose **Claim replacement** and the available invalid-contact demonstration action.
3. Switch to Operations → **Replacements** and approve or reject the claim after reviewing it.
4. Show the employer credit and linked partner reward reversal when approved.

**Say:** “An invalid lead may qualify for replacement. Failing an interview is not a replacement reason.”

The current claim control supplies a sample invalid-contact reason/evidence statement; it is not a real call-log upload. Do not claim actual contact verification took place.

## 3. Partner — source and assist candidates

### P1. Understand the job and share a source

1. Select CareerSetu or another verified partner.
2. Open **Conduct rules** and record acceptance.
3. Open **Job alerts** to show available roles and rewards.
4. Open **QR sites**, then show or scan an active site’s QR; alternatively copy its partner code into the candidate journey.

**Say:** “Partners share approved opportunities using a source the platform can attribute.”

### P2. Assist a candidate

1. Register a candidate through this partner and explicitly choose partner-assistance consent.
2. Return as the partner → **My candidates**.
3. Find the candidate, click **Nudge**, choose a job and send the platform message.
4. Switch to the candidate → **Alerts & messages** to show the message.

**Show:** assistance is consent-based, uses controlled wording and is limited to two nudges per candidate per week.

### P3. Track rewards

1. Open **Rewards** after an employer has unlocked a candidate attributed to this partner.
2. Show the earning and whether it is in hold, eligible or paid.
3. After Finance pays it, show the payout record and **Download statement**.

**Say:** “Scanning, registering or applying does not itself earn a reward. A valid attributed unlock does.”

Partners do not edit other employers or partners. Organisation and site maintenance is performed by Operations.

## 4. Job Seeker — apply and control personal information

### J1. Register and become eligible

1. Open **WhatsApp journey** (`/wa`) and choose a language.
2. Enter an unused synthetic number and active partner code, or leave the source blank for direct registration.
3. Verify with `123456`.
4. Explicitly choose processing, job-alert and partner-assistance permissions.
5. Enter age/work declarations, locality, experience, languages, expected pay, commute and shifts; choose a role and complete its required fields.
6. Complete its assessment within the displayed time limit.

**Show:** the application collects the candidate’s own declarations and scores the assessment on the server.

For a rehearsal against the seeded Relationship Executive job, a synthetic profile can use Shivajinagar, 18 months’ experience, Marathi/Hindi, ₹18,000 expected pay, a 45-minute commute limit and Any shift. Complete the required role declarations accurately for the fictional scenario. Qualification still depends on all configured gates and the assessment result.

### J2. Apply and separately confirm interest

1. Open an available job and click **Apply**.
2. Pause to show the separate confirmation question.
3. Click **Yes, I am interested**.
4. Inspect whether the profile qualifies, or explain the displayed missing requirements.

**Alternative:** choose **Not now**, then return through **Alerts & messages** and reconfirm later.

**Say:** “Applying alone does not allow an employer to unlock the profile.”

### J3. Manage interviews and offers

1. Open **Alerts & messages** after the employer sends an invitation.
2. Confirm attendance or decline.
3. When an offer arrives, inspect its terms and accept or decline.
4. After acceptance, complete the simulated document checklist.

**Show:** the candidate actively responds at each stage.

### J4. Edit preferences and build credibility

1. Open **Profile & preferences** and change expected pay, commute, quiet hours or alert frequency.
2. Save and show the changed preferences.
3. Add a self-reported achievement.
4. Create an endorsement invitation for a fictional former manager/colleague.
5. Open the invitation as the endorser, complete its verification/consent and submit.
6. Return to the candidate and hide/show the endorsement.

**Say:** “Achievements are labelled candidate-provided. Endorsements can improve ranking, but cannot bypass eligibility requirements.”

### J5. Consent, source correction and data rights

1. Under **Profile & preferences**, demonstrate withdrawing one optional permission.
2. For a sourced candidate who has not yet applied, submit a source-correction request with the intended code and reason; complete O6.
3. Under **My data**, show where the profile has been shared and submit an access request.
4. Complete O7 as Operations; return and download the data.

**Optional final demonstration:** submit erasure for a disposable candidate and resolve it. Its profile becomes unavailable; do not use your main demonstration candidate.

## 5. Finance — pay and reconcile

### F1. Hold, eligibility and payout threshold

1. Open **Partner balances** and show the current balances.
2. As Administrator, open the main dashboard’s **Demo clock** and use **+73h (clears hold)** for newly earned rewards.
3. Return as Finance and click **Release matured holds** if needed.
4. Click **Build weekly payout batch**.
5. Show either the new payout or the explicit below-minimum/no-instrument reason.

**Say:** “The default reward is ₹75, with a 72-hour hold and a ₹500 payout minimum. They are editable demo settings.”

### F2. Approve and explain a payout

**Prerequisite:** an eligible partner balance meeting the configured minimum and a demo payout reference.

1. Open **Payout batches** and inspect the pending payout.
2. Show gross earnings, deductions and net amount.
3. Click **Approve & pay**.
4. Show its simulated-paid status, **Reward ledger**, and statement download.
5. Build another batch without creating new earnings; show that the same earnings are not reserved again.

### F3. Demonstrate payment failure and retry

1. Before paying a pending payout, switch to Administrator → **Demo identities → Demo operations**.
2. Enable **Simulate payout failure** and save.
3. Return as Finance and try **Approve & pay**; show the failure/pending state.
4. Switch back, turn the failure flag off and save.
5. Retry the same payout as Finance.

**Show:** a retry settles the existing payout rather than duplicating it. No real money is transferred.

### F4. Recover an already-paid reward — advanced demonstration

Prepare this scenario separately; timing matters.

1. Create a valid attributed unlock and raise its replacement claim **within the 72-hour claim window**, leaving it pending.
2. Advance beyond the reward hold, meet the payout minimum and complete the simulated payout.
3. Now approve the already-open replacement claim as Operations.
4. Open Finance → **Partner balances** and show the resulting recovery balance.
5. When that partner has further eligible earnings meeting the minimum, build/pay a new payout and show the recovery deduction in its statement.

**Say:** “The system records money to recover and deducts it from future payouts. It does not pretend to retrieve a completed bank payment.”

Do not attempt to raise a new claim after advancing past its claim window. For a short demonstration, show the recorded recovery balance and explain the later offset instead of creating another full batch live.

## 6. Administrator — prepare and control the demo

| Use case | Simple flow | Result to show |
|---|---|---|
| Switch roles | Demo identities → select role/person → Open selected view | The selected identity governs access. |
| Adjust demo economics | Operations → Manage & catalogue → Commercial & matching defaults → edit → Save | Editable reward, minimum, unlock price, salary basis and endorsement cap. |
| Publish configuration | Operations → Configurations → Validate → Publish | Only a validated configuration becomes available for new jobs. |
| Demonstrate failed messages | Demo operations → enable message failure → trigger a candidate message → disable failure → Retry failed messages | A controlled delivery failure and retry, without sending a real WhatsApp message. |
| Process due work | Demo operations → Process due reminders, expiries and reward holds | Due work is processed using the demo clock. |
| Demonstrate expiry | Main dashboard → Demo clock → +31d | Jobs expire; perform this last or on a separate rehearsal dataset. |
| Restore sample data | Demo operations → type RESET DEMO → Restore original demo data | Discards demo edits and restores sample records; requires reset to be enabled. |

Resetting only the clock does not restore deleted records, undo payouts or make expired jobs live again. Restore the full dataset only when the demo changes can be discarded.

## Closing line

“NayiDisha connects verified employers, local sourcing partners and job seekers. Candidates control consent and interest; employers pay for qualified profile access; partner rewards and corrections remain traceable through Finance and Operations.”
