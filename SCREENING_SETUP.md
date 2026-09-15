# QR screening journey — setup

Scan a code → consent → voice screening → structured profile → matching.

## Which provider runs the conversation

Set `SCREENING_PROVIDER`. Default is `browser`.

| Value | What happens | Cost | Works today |
|---|---|---|---|
| *(unset)* / `browser` | The questions are asked **on the page**, in the candidate's browser. Same conversation, same structured result, no phone call. | free | ✅ |
| `raya` | A real outbound call from Raya to the candidate's mobile. | ₹1/min + monthly commitment | ⚠️ needs credentials **and** DLT registration |

### Why browser is the default

Placing automated commercial calls to Indian mobiles requires registering your
business as a Principal Entity on a TRAI **DLT** platform (Airtel/Jio/Vi) with
PAN, GST and Certificate of Incorporation, plus registered caller IDs and
templates. Penalties reach ₹10 lakh. No vendor sells around that on a free tier.

So a telephony default would make this feature untestable for anyone without a
registered company. The browser provider gives the identical journey and result
at no cost and outside that regime. It is **not** described as a phone call in
the UI — the page says the questions are asked there and the phone will not ring.

## Enabling Raya (when you have credentials)

`src/modules/adapters/screening.ts` → `RayaScreeningProvider`.

**The endpoint and field names in there are placeholders, not a verified
contract.** Raya's API reference (`docs.litwizlabs.com`) returns 403, so it is
not public. Ask Raya for:

1. Base URL and the outbound-call path
2. Auth header format
3. Request body schema
4. Webhook payload shape
5. **How webhook signatures are computed** — `verifySignature` currently assumes
   HMAC-SHA256 hex over the raw body in `x-screening-signature`

Then correct `RAYA_ENDPOINT`, the request body, and `verifySignature`. Nothing
outside that file needs to change.

```bash
SCREENING_PROVIDER=raya
RAYA_API_KEY=...
RAYA_AGENT_ID=...
RAYA_API_URL=https://<real-base>/<real-path>
SCREENING_WEBHOOK_SECRET=<a long random string>
```

Point Raya's webhook at `https://<your-domain>/api/screening/webhook`.

## Voice interpretation

Which model turns a spoken answer into a profile field:

| Env | Interpreter | Cost |
|---|---|---|
| `GEMINI_API_KEY` | Gemini 2.5 Flash — **recommended** | free tier: 10 req/min, 500/day, permanent, no card |
| `ANTHROPIC_API_KEY` | Claude | paid |
| *(neither)* | Rule-based | free, offline, but only handles phrasing it was written for |

Get a Gemini key at <https://aistudio.google.com/apikey>. Roughly seven
interpretations per candidate, so the free tier covers about 70 candidates a day.

A model cannot fix a bad transcript. If speech recognition mishears a word, no
interpreter downstream recovers it — that is a recognition problem. Marathi
recognition is the weakest of the three languages and varies by browser and OS.

## Consent

Being phoned or screened by an automated agent is **not** covered by
`PROCESSING` (job matching) or `JOB_ALERTS` (messages). It has its own
`VOICE_SCREENING` purpose, grantable and withdrawable on its own, and
`startScreening` refuses without it — the refusal is recorded as a
`CONSENT_MISSING` row rather than silently dropped.

If you move to Raya, note that `recording_ref` means **the vendor stores the
candidate's audio**. That is a new category of personal data: the CAN-06 erasure
path clears the reference, but you must also call Raya to delete the recording
itself.

## Testing it

1. `npm run db:migrate` (adds `011_screening_call.sql`)
2. Partner console → QR sites → copy a site's code
3. Open `/wa?code=<code>`, register, verify, consent
4. Go to `/wa/screening?code=<code>` → agree → **Start screening**
5. Answer aloud; the result posts through the signed webhook
6. Operations → Candidates → the profile now carries the spoken answers

The webhook is the same signed path in development and production — there is no
dev bypass to rot.
