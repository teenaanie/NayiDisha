# Voice journey — demo script

A run-through for demoing the candidate journey by voice, as a job applicant.

## Before you start

| | |
|---|---|
| **Browser** | Chrome, Edge or Safari. **Firefox has no speech recognition** and will drop to typing. |
| **Microphone** | Allow it when prompted. A blocked mic falls back to typing, which still demos the interpretation but not the voice capture. |
| **Migration** | `npm run db:migrate` — adds `app.voice_turn`. Without it the journey still runs but transcript storage fails. |
| **Phone number** | Use one **not** in the seed data, e.g. `+910000000077`. Seeded numbers (`...0001`–`...0010`) are existing candidates and will redirect you to their profile instead of starting fresh. |
| **Interpretation** | With no `ANTHROPIC_API_KEY` set, the free rule-based interpreter runs. That's what the phrases below are tuned for. |

## The run

**1. Open `/wa`** → "Start a new candidate journey".

**2. Start screen**
- Language: pick **English**, **हिन्दी** or **मराठी** — this drives both the spoken questions and the speech recogniser.
- Demo mobile number: `+910000000077`
- Partner code: leave blank (or `qr_` + a site token to demo partner attribution)
- → **Start conversation**

**3. OTP** → `123456`

**4. Consent** → tick **"Allow processing for job matching"** (required; the other two are optional and worth leaving unticked once, to show they're genuinely optional).

**5. Profile → tap "🎤 Answer by voice"**

This is the part to demo. Each question is **spoken aloud and shown as a bubble**. Tap the green mic, speak, and your answer comes back as a **WhatsApp voice note with the transcript under it**.

### What to say

| Question | English | हिन्दी | मराठी | Should read back |
|---|---|---|---|---|
| Your name | "My name is Sunita Shinde" | "मेरा नाम सुनीता शिंदे है" | "माझं नाव सुनीता शिंदे आहे" | Sunita Shinde |
| Which area | "I live in Aundh" | "मैं औंध में रहती हूँ" | "माझं घर कोथरूड आहे" | Aundh / Kothrud |
| Experience | "I have two years experience" | "मुझे दो साल का अनुभव है" | "मला दोन वर्षांचा अनुभव आहे" | 2 year(s) — 24 months |
| Past work | "Field sales and customer service" | "फील्ड सेल्स और कस्टमर सर्विस" | "फील्ड सेल्स आणि कस्टमर सर्विस" | FIELD_SALES, CUSTOMER_SERVICE |
| Expected pay | "Twenty five thousand" | "अठारह हज़ार" | "वीस हजार" | ₹25,000 / ₹18,000 / ₹20,000 |
| Commute | "45 minutes" | "तीस मिनट" | "पंचेचाळीस मिनिटे" | 45 / 30 / 45 minutes |
| Shift | "Any shift" | "कोई भी शिफ्ट" | "कोणतीही शिफ्ट" | Any shift |

**Say the skills line as written** — `FIELD_SALES` and `CUSTOMER_SERVICE` are the transferable tags the seeded BFSI roles actually score against, so the match comes out strong later. Say something unrelated ("cooking and cleaning") and you'll demo a weak match instead, which is also a legitimate thing to show.

### Moments worth pointing out

- **It reads back before accepting.** Anything it's less than ~72% sure of is spoken back — *"I heard: ₹25,000 per month"* — and waits for **Yes, correct** / **No, say again**.
- **It refuses to guess.** Mumble, or answer something off-topic, and it says *"I did not catch that"* and re-asks rather than inventing a value.
- **Numbers the way people actually say them.** "Twenty five thousand", "18 hazaar", "अठारह हज़ार", "two years" and "eighteen months" all land correctly.
- **Say it wrong on purpose once.** Answer the pay question with "fifty" and it'll read back ₹50,000 — tap **No, say again** to show correction works.

**6. Review → Save**
Voice answers land in the **same** `saveProfile` call the typed form uses. The two legal declarations (18+, work authorisation) stay as **checkboxes** — they're deliberately not inferred from speech. Pick a role (`CUSTOMER_SERVICE_ASSOCIATE` or `RELATIONSHIP_EXECUTIVE`) and save.

**7. Continue the normal journey** — assessment → available jobs → **Apply** → **Yes, I am interested**. You'll get a qualification result and score built from the profile you just *spoke*.

## The payoff shot — Operations side

Sign in as **Operations** (`/demo` → Operations) → **Candidates** → open the candidate you just created.

There's a **"Voice answers"** card showing, per question: **what was said** (the raw transcript), **what was understood**, a **confidence %**, and **which interpreter** produced it.

That's the thing to land: a voice-captured profile is *auditable*. An operator can see the candidate said "मेरा नाम सुनीता शिंदे है" and the system recorded "Sunita Shinde" — rather than being asked to trust a black box.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Mic button does nothing | Firefox, or mic permission denied. Use **Type instead** — the interpretation demo is identical. |
| No question is spoken aloud | Some browsers need a user gesture before speech synthesis. Tap the mic once; audio starts from the next question. |
| Marathi recognised poorly | `mr-IN` coverage varies by browser/OS and is the weakest of the three. Chrome on Android is best; desktop Safari is worst. |
| Every answer says "I did not catch that" | Check the recogniser language matches what you're speaking — it follows the language you picked on the start screen. |
| Candidate page errors | The migration hasn't run. `npm run db:migrate`. |

## Verifying the parsing without a demo

`npx tsx scripts/voice-parse-check.ts` runs 31 phrases across all three languages and prints what each resolves to. No database or microphone needed.
