# Sales practice and WhatsApp self-registration

Two additions, built on the existing adapter pattern: every external service is optional, and the demo runs without it.

## 1. Sales practice (AI roleplay)

This implements `doc/Education Loan Simulation Example.docx`. A candidate plays an Education Loan Sales Officer. The AI customer is Mr. Rajesh Sharma.

| Layer | Where | What it does |
|---|---|---|
| Scenario | `db/migrations/013_sales_simulation.sql` (`EDU_DISCOVERY_001`) | Persona, disclosable facts and when each may be revealed, the pitch deflection, the 6×5 rubric, risk phrases and bands |
| AI customer | `src/modules/simulation/agents.ts` `customerTurn` | Reveals a fact only when asked; the server records each reveal. An early pitch always gets the scenario's own deflection line |
| Evaluator | `agents.ts` `evaluate` + `rules.ts` | Kept separate from the customer. Rules decide coverage, risk flags and early pitching; a model judges quality, bounded by the rules. A hard compliance breach caps responsible selling at 1 and marks the band |
| Coach | `rules.ts` `ruleReport` (or the model's text) | Strengths, improvements with example questions, best moment, missed opportunity, and a retry focus |

Where to find it:
- **Candidates:** `/wa/practice` (text chat, mic, read-aloud, 12-minute timer, report, retry)
- **Operations:** `/ops/simulations` (skill averages, questions asked, risk statements, gain after retry, readiness) and the "Sales practice" card on each candidate record
- The best result is stored as the role attribute `sales_roleplay_band`.

**Providers.** They are chosen per call:
- Customer: Sarvam, then Claude, then Gemini, then scripted rules.
- Evaluator: Claude, then Gemini, then Sarvam, then rules. A rules-only result is flagged for review.
- `SARVAM_API_KEY` enables:
  - all 11 Sarvam languages
  - speech-to-text through Saarika (behind a separate `SIMULATION_VOICE` consent, because audio leaves the device)
  - read-aloud through Bulbul
  - translation through Mayura, so one English rubric can score every language
- Without Sarvam:
  - English, Hindi and Marathi only
  - browser speech
  - non-English transcripts are scored by rules only

**Calibration:** `npx tsx --env-file-if-exists=.env.local scripts/simulation-eval-check.ts`. Add `--rules-only` to skip model calls.

## 2. WhatsApp self-registration

1. Operations goes to `/ops/whatsapp-invites` and invites one or more numbers.
2. The candidate taps **Yes** in WhatsApp.
3. They fill a four-screen form: consent, about you, work, and pay + resume.
4. The candidate is registered (status `PROFILE_INCOMPLETE`, mobile verified, consent recorded) and receives a sign-in link.
5. They sign in with mobile + OTP and land on the journey, prefilled, which asks only what matching still needs. They can also browse jobs first.

Components:
- **Form definition:** `src/modules/registration/flow.ts`. This single definition drives the simulator form, the validation and `metaFlowJson()`, the Meta WhatsApp Flow export.
- **Webhook:** `/api/whatsapp/webhook`. It accepts HMAC-signed normalised events. The simulator (`/wa/invite/<token>`) posts to it exactly as a production adapter would.
- **Resumes:**
  - They go to a private Supabase Storage bucket when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise to `app.stored_object`.
  - Files are PDF or Word up to 4 MB, checked by content.
  - Download is at `/api/resume/<id>`, for operations, the candidate, or an employer who has unlocked the candidate.
- **Erasure** removes resumes, stored files, practice transcripts and the new profile fields.

### Going live on real WhatsApp
1. Get a WhatsApp Business account and a verified number, through Meta directly or a BSP such as Gupshup or Interakt.
2. Submit the `job_invite` (MARKETING), `registration_form` and `registration_link` (UTILITY) templates for approval.
3. Publish the Flow from `metaFlowJson()`.
4. Add a provider adapter in `src/modules/adapters/messaging.ts` that:
   - verifies Meta's `X-Hub-Signature-256`
   - maps inbound replies and Flow completions to the normalised events
   - downloads the DocumentPicker media into storage
   - calls `handleInviteReply` / `handleFlowSubmission`
5. Set `WHATSAPP_VERIFY_TOKEN` for the subscription handshake (`GET` on the webhook).
6. For real OTPs, implement `OtpProvider` (in `messaging.ts`). Sending SMS OTPs in India requires DLT registration; a WhatsApp AUTHENTICATION template is the alternative.

## Tests
`npm test` now includes the SIM-01…06, REG-01…05 and CAN-06 (erasure) checks.
