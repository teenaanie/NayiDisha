import { sql } from '@/lib/db';

/**
 * Spoken-answer interpreter (voice journey).
 *
 * The candidate speaks; the browser turns speech into text; this adapter turns
 * that text into one structured profile field. Same shape as the travel
 * adapter: an interface, a zero-cost deterministic implementation used by
 * default, and a paid one that only engages when it is configured.
 *
 * Audio never reaches the server. The browser's own speech recognition
 * produces a transcript and only that transcript is sent — there is no
 * recording to store, leak or subject-access.
 */

export type VoiceField =
  | 'name' | 'locality' | 'experienceMonths' | 'skills'
  | 'expectedPay' | 'commute' | 'shifts' | 'confirm';

export type Language = 'en' | 'hi' | 'mr';

export interface Interpretation {
  /** Normalised value in the shape `saveProfile` expects, or null if unclear. */
  value: string | number | string[] | boolean | null;
  /** What to read back to the candidate for confirmation, in their language. */
  display: string;
  /** 0–1. Below CONFIRM_THRESHOLD the journey asks the candidate to confirm. */
  confidence: number;
  provider: string;
}

export interface VoiceInterpreter {
  readonly name: string;
  interpret(field: VoiceField, transcript: string, language: Language,
            context?: { localities?: { key: string; display_name: string }[]; shifts?: string[] }): Promise<Interpretation>;
}

export const CONFIRM_THRESHOLD = 0.72;

// ---------------------------------------------------------------------------
// Number parsing across en / hi / mr
// ---------------------------------------------------------------------------

/** Devanagari digits map to ASCII so "१८०००" parses like "18000". */
const DEVANAGARI = '०१२३४५६७८९';
function asciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));
}

/** Spoken number words people actually use for pay, months and minutes. */
const WORD_NUMBERS: Record<string, number> = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, fifteen:15, twenty:20, thirty:30, forty:40, fortyfive:45, fifty:50, sixty:60,
  // Hindi / Marathi, as they commonly transcribe
  ek:1, do:2, teen:3, char:4, paanch:5, panch:5, chhah:6, chha:6, saat:7, aath:8, nau:9, das:10,
  barah:12, pandrah:15, bees:20, tees:30, chalis:40, pachas:50, saath:60,
  एक:1, दो:2, तीन:3, चार:4, पाँच:5, पांच:5, छह:6, सात:7, आठ:8, नौ:9, दस:10,
  बारह:12, पंद्रह:15, बीस:20, तीस:30, चालीस:40, पचास:50, साठ:60,
  दोन:2, चार_mr:4, पाच:5, सहा:6, नऊ:9, अकरा:11, पंधरा:15, वीस:20, तीस_mr:30,
};

/** "18 hazaar" / "18 हजार" / "1.5 lakh" → 18000 / 150000. */
const MULTIPLIERS: [RegExp, number][] = [
  [/\b(lakh|lac|lakhs|लाख)\b/i, 100000],
  [/\b(hazaar|hazar|thousand|हज़ार|हजार|हजार्|k)\b/i, 1000],
];

function parseNumber(raw: string): number | null {
  const t = asciiDigits(raw.toLowerCase());

  // "18 thousand", "1.5 lakh"
  for (const [re, mult] of MULTIPLIERS) {
    const m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${re.source}`, 'i'));
    if (m) return Math.round(parseFloat(m[1]) * mult);
  }
  // bare digits — longest run wins ("eighteen thousand five hundred" is rare in transcripts)
  const digits = t.match(/\d+(?:\.\d+)?/g);
  if (digits) {
    const n = Math.round(parseFloat(digits.sort((a, b) => b.length - a.length)[0]));
    // a lone "18" for pay almost always means 18 thousand
    return n;
  }
  // number words
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`(^|\\s)${word.replace('_mr','')}(\\s|$)`, 'i').test(t)) {
      for (const [re, mult] of MULTIPLIERS) if (re.test(t)) return n * mult;
      return n;
    }
  }
  return null;
}

const YES = /\b(yes|yeah|yep|correct|right|haan|han|ha|ji|sahi|theek|बरोबर|हाँ|हां|जी|सही|ठीक|होय)\b/i;
const NO  = /\b(no|nope|wrong|nahi|nahin|galat|चुकीच|नहीं|नाही|गलत)\b/i;

/** Shift words → the shift codes the seed data uses. */
function matchShifts(t: string, available: string[]): string[] {
  const lower = t.toLowerCase();
  const any = /\b(any|anytime|any shift|koi bhi|kabhi bhi|कोई भी|कधीही|कोणतीही)\b/i.test(lower);
  if (any) return ['ANY'];
  const hits = available.filter((s) => lower.includes(s.toLowerCase().replace(/_/g, ' ')));
  if (hits.length) return hits;
  if (/\b(day|morning|din|सकाळ|दिवस|सुबह)\b/i.test(lower)) {
    const day = available.find((s) => /DAY|09|10/.test(s));
    if (day) return [day];
  }
  if (/\b(night|raat|रात|रात्र)\b/i.test(lower)) {
    const night = available.find((s) => /NIGHT|22|20/.test(s));
    if (night) return [night];
  }
  return [];
}

export class RuleBasedInterpreter implements VoiceInterpreter {
  readonly name = 'rule-based@1.0';

  async interpret(
    field: VoiceField, transcript: string, language: Language,
    context: { localities?: { key: string; display_name: string }[]; shifts?: string[] } = {},
  ): Promise<Interpretation> {
    const t = transcript.trim();
    const out = (value: Interpretation['value'], display: string, confidence: number): Interpretation =>
      ({ value, display, confidence, provider: this.name });

    if (!t) return out(null, '', 0);

    switch (field) {
      case 'confirm': {
        if (YES.test(t)) return out(true, t, 0.95);
        if (NO.test(t)) return out(false, t, 0.95);
        return out(null, t, 0.2);
      }

      case 'name': {
        // Strip the lead-ins people say before their name.
        const cleaned = t
          .replace(/^(my name is|i am|i'm|this is|mera naam|maza nav|माझं नाव|माझे नाव|मेरा नाम)\s*/i, '')
          .replace(/\s*(hai|ahe|आहे|है)\s*$/i, '')
          .replace(/[.,!?]+$/, '')
          .trim();
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 5) return out(null, cleaned, 0.3);
        const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
        return out(name, name, cleaned === t ? 0.75 : 0.9);
      }

      case 'locality': {
        const list = context.localities ?? [];
        const lower = asciiDigits(t.toLowerCase());
        // exact display-name or key hit
        const exact = list.find((l) =>
          lower.includes(l.display_name.toLowerCase()) || lower.includes(l.key.replace(/_/g, ' ')));
        if (exact) return out(exact.key, exact.display_name, 0.95);
        // token overlap — handles "I live in Aundh area"
        const scored = list
          .map((l) => {
            const name = l.display_name.toLowerCase();
            const hit = name.split(/\s+/).some((part) => part.length > 3 && lower.includes(part));
            return { l, hit };
          })
          .filter((x) => x.hit);
        if (scored.length === 1) return out(scored[0].l.key, scored[0].l.display_name, 0.8);
        return out(null, t, 0.25);
      }

      case 'experienceMonths': {
        const n = parseNumber(t);
        if (n === null) {
          if (/\b(fresher|no experience|none|naya|नया|नवीन|अनुभव नाही|कोई अनुभव नहीं)\b/i.test(t)) {
            return out(0, 'Fresher — no experience yet', 0.9);
          }
          return out(null, t, 0.2);
        }
        // "2 years" → 24 months
        const years = /\b(year|years|saal|varsh|साल|वर्ष|वर्षे)\b/i.test(t);
        const months = years ? n * 12 : n;
        if (months > 900) return out(null, t, 0.2);
        return out(months, years ? `${n} year(s) — ${months} months` : `${months} months`, 0.85);
      }

      case 'expectedPay': {
        let n = parseNumber(t);
        if (n === null) return out(null, t, 0.2);
        // "18" spoken for pay means 18 thousand; nobody expects ₹18/month.
        if (n > 0 && n < 1000) n = n * 1000;
        if (n < 3000 || n > 1000000) return out(null, t, 0.25);
        return out(n, `₹${n.toLocaleString('en-IN')} per month`, 0.85);
      }

      case 'commute': {
        const n = parseNumber(t);
        if (n === null) return out(null, t, 0.2);
        const hours = /\b(hour|hours|ghanta|ghante|घंटा|घंटे|तास)\b/i.test(t);
        const mins = hours ? n * 60 : n;
        if (mins < 1 || mins > 240) return out(null, t, 0.25);
        return out(mins, `${mins} minutes`, 0.85);
      }

      case 'skills': {
        const cleaned = t.replace(/^(i (have|know|can|did)|mujhe|mala|मुझे|मला)\s*/i, '').trim();
        const parts = cleaned
          .split(/[,;]|\band\b|\baur\b|\bआणि\b|\bऔर\b/i)
          .map((s) => s.trim().replace(/[.!?]+$/, ''))
          .filter((s) => s.length > 1 && s.length < 40);
        if (!parts.length) return out(null, t, 0.2);
        const tags = parts.slice(0, 6).map((s) => s.toUpperCase().replace(/\s+/g, '_'));
        return out(tags, parts.join(', '), 0.7);
      }

      case 'shifts': {
        const hits = matchShifts(t, context.shifts ?? []);
        if (!hits.length) return out(null, t, 0.2);
        return out(hits, hits.map((s) => (s === 'ANY' ? 'Any shift' : s)).join(', '), 0.8);
      }
    }
  }
}

/**
 * Real-model interpreter. Engages only when ANTHROPIC_API_KEY is set, so the
 * demo stays free by default and a deployment can opt into better handling of
 * accents, code-switching and unusual phrasing by adding one variable.
 */
export class ClaudeInterpreter implements VoiceInterpreter {
  readonly name = 'claude-sonnet-5';
  private fallback = new RuleBasedInterpreter();

  async interpret(
    field: VoiceField, transcript: string, language: Language,
    context: { localities?: { key: string; display_name: string }[]; shifts?: string[] } = {},
  ): Promise<Interpretation> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return this.fallback.interpret(field, transcript, language, context);

    const schema: Record<VoiceField, string> = {
      name: 'a person\'s name as a string',
      locality: `one key from this list: ${(context.localities ?? []).map((l) => l.key).join(', ')}`,
      experienceMonths: 'total work experience as an integer number of months',
      skills: 'an array of 1-6 UPPER_SNAKE_CASE skill tags',
      expectedPay: 'expected monthly pay as an integer number of rupees',
      commute: 'maximum one-way commute as an integer number of minutes',
      shifts: `an array of shift codes from: ${(context.shifts ?? []).join(', ')}`,
      confirm: 'true if the speaker agreed, false if they disagreed',
    };

    const body = {
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system:
        'You extract one structured field from a spoken answer by an Indian frontline job seeker. ' +
        'They may speak English, Hindi or Marathi, or mix them. Reply with ONLY a JSON object: ' +
        '{"value": <the value or null>, "display": "<short confirmation in the speaker\'s language>", "confidence": <0-1>}. ' +
        'Use null and low confidence when the answer is unclear or off-topic. Never invent a value.',
      messages: [{
        role: 'user',
        content: `Field: ${field} (${schema[field]})\nSpeaker language: ${language}\nTranscript: ${JSON.stringify(transcript)}`,
      }],
    };

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
      const json = await res.json();
      const raw = json?.content?.[0]?.text ?? '';
      const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return {
        value: parsed.value ?? null,
        display: String(parsed.display ?? transcript),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        provider: this.name,
      };
    } catch {
      // A model outage must not strand a candidate mid-journey.
      return this.fallback.interpret(field, transcript, language, context);
    }
  }
}

export function voiceInterpreter(): VoiceInterpreter {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeInterpreter() : new RuleBasedInterpreter();
}

/** Context the interpreter needs to resolve localities and shift codes. */
export async function interpreterContext() {
  const [localities, shifts] = await Promise.all([
    sql<{ key: string; display_name: string }[]>`SELECT key, display_name FROM app.locality ORDER BY display_name`,
    sql<{ shift: string }[]>`SELECT DISTINCT shift FROM app.job WHERE status='LIVE'`,
  ]);
  return { localities, shifts: ['ANY', ...shifts.map((s) => s.shift)] };
}
