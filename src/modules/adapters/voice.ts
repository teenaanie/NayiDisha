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

/**
 * A field key. The seven profile fields plus 'confirm' are the core set, but a
 * role script may ask about anything its configuration declares, so this is a
 * string rather than a closed union. Unknown keys are rejected at the action
 * boundary against the active script, not by the type.
 */
export type VoiceField = string;

export const CORE_FIELDS = [
  'name', 'locality', 'experienceMonths', 'skills',
  'expectedPay', 'commute', 'shifts', 'confirm',
] as const;

export type CoreField = (typeof CORE_FIELDS)[number];

export const isCoreField = (f: string): f is CoreField =>
  (CORE_FIELDS as readonly string[]).includes(f);

/**
 * What a script turn expects back, so an interpreter can describe a field it
 * has never seen. `expected` is the sentence handed to the model; the rule-based
 * interpreter uses `dataType` and `allowedValues` instead.
 */
export interface FieldSpec {
  key: string;
  dataType: 'TEXT' | 'INT' | 'BOOL' | 'ENUM' | 'MULTI_ENUM' | 'MONEY_PAISE';
  expected: string;
  allowedValues?: string[];
}

export interface InterpretContext {
  localities?: { key: string; display_name: string }[];
  shifts?: string[];
  /** Supplied for a script field; absent for the core eight. */
  spec?: FieldSpec;
}

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
            context?: InterpretContext): Promise<Interpretation>;
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
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17,
  eighteen:18, nineteen:19, twenty:20, twentyfive:25, thirty:30, thirtyfive:35, forty:40,
  fortyfive:45, fifty:50, sixty:60, ninety:90,
  // Hindi / Marathi, as they commonly transcribe
  ek:1, do:2, teen:3, char:4, paanch:5, panch:5, chhah:6, chha:6, saat:7, aath:8, nau:9, das:10,
  barah:12, pandrah:15, bees:20, tees:30, chalis:40, pachas:50, saath:60,
  एक:1, दो:2, तीन:3, चार:4, पाँच:5, पांच:5, छह:6, सात:7, आठ:8, नौ:9, दस:10,
  ग्यारह:11, बारह:12, तेरह:13, चौदह:14, पंद्रह:15, सोलह:16, सत्रह:17, अठारह:18, उन्नीस:19,
  बीस:20, पच्चीस:25, तीस:30, पैंतीस:35, चालीस:40, पैंतालीस:45, पचास:50, साठ:60,
  athara:18, pandrah_hi:15, pachees:25, paintalis:45,
  दोन:2, चार_mr:4, पाच:5, सहा:6, नऊ:9, अकरा:11, बारा:12, पंधरा:15, सोळा:16,
  अठरा:18, वीस:20, पंचवीस:25, तीस_mr:30, पस्तीस:35, चाळीस:40, पंचेचाळीस:45, पन्नास:50,
};

/** "18 hazaar" / "18 हजार" / "1.5 lakh" → 18000 / 150000. */
const MULTIPLIERS: [RegExp, number][] = [
  [/\b(lakh|lac|lakhs|लाख)\b/i, 100000],
  [/\b(hazaar|hazar|thousand|हज़ार|हजार|हजार्|k)\b/i, 1000],
];

const TENS: Record<string, number> = {
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
  बीस:20, तीस:30, चालीस:40, पचास:50, साठ:60, सत्तर:70, अस्सी:80, नब्बे:90,
  वीस:20, चाळीस:40, पन्नास:50, साठ_mr:60,
};
const UNITS: Record<string, number> = {
  one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  एक:1, दो:2, तीन:3, चार:4, पाँच:5, पांच:5, छह:6, सात:7, आठ:8, नौ:9,
  दोन:2, पाच:5, सहा:6, नऊ:9,
};

/**
 * Devanagari text breaks `\b`, which JS defines over [A-Za-z0-9_] only, so a
 * Devanagari alternative inside \b(...)\b never matches. Latin alternatives
 * keep word boundaries; Devanagari ones are matched as plain substrings.
 */
function hasWord(text: string, latin: string[], devanagari: string[] = []): boolean {
  if (latin.length && new RegExp(`\\b(${latin.join('|')})\\b`, 'i').test(text)) return true;
  return devanagari.some((d) => text.includes(d));
}

function parseNumber(raw: string): number | null {
  const t = asciiDigits(raw.toLowerCase());
  const multiplier = () => {
    for (const [re, mult] of MULTIPLIERS) if (re.test(t)) return mult;
    return 1;
  };

  // "18 thousand", "1.5 lakh" — digits carrying a multiplier.
  for (const [re, mult] of MULTIPLIERS) {
    const m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${re.source}`, 'i'));
    if (m) return Math.round(parseFloat(m[1]) * mult);
  }
  // bare digits
  const digits = t.match(/\d+(?:\.\d+)?/g);
  if (digits) {
    const n = Math.round(parseFloat(digits.sort((a, b) => b.length - a.length)[0]));
    return n * (digits.join('').length <= 3 ? multiplier() : 1);
  }
  // compound words: "twenty five" = 25, and only then × any multiplier.
  for (const [tensWord, tens] of Object.entries(TENS)) {
    const tw = tensWord.replace('_mr', '');
    if (!t.includes(tw)) continue;
    const after = t.slice(t.indexOf(tw) + tw.length, t.indexOf(tw) + tw.length + 12);
    for (const [unitWord, unit] of Object.entries(UNITS)) {
      if (after.includes(unitWord)) return (tens + unit) * multiplier();
    }
    return tens * multiplier();
  }
  // single number words
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    const w = word.replace('_mr', '').replace('_hi', '');
    const hit = /^[a-z]+$/.test(w)
      ? new RegExp(`(^|\\s)${w}(\\s|$)`, 'i').test(t)
      : t.includes(w);
    if (hit) return n * multiplier();
  }
  return null;
}

const YES_LATIN = ['yes','yeah','yep','correct','right','haan','han','ji','sahi','theek','hoy'];
const YES_DEV = ['हाँ','हां','जी','सही','ठीक','बरोबर','होय','हो'];
const NO_LATIN = ['no','nope','wrong','nahi','nahin','galat','chukiche'];
const NO_DEV = ['नहीं','नाही','गलत','चुकीच','नको'];

/** Shift words → the shift codes the seed data uses. */
function matchShifts(t: string, available: string[]): string[] {
  const lower = t.toLowerCase();
  const any = hasWord(lower, ['any','anytime','koi bhi','kabhi bhi','kuthlihi'],
                      ['कोई भी','कधीही','कोणतीही','कोणतीहि']);
  if (any) return ['ANY'];
  const hits = available.filter((s) => lower.includes(s.toLowerCase().replace(/_/g, ' ')));
  if (hits.length) return hits;
  if (hasWord(lower, ['day','morning','din'], ['सकाळ','दिवस','सुबह','दिन'])) {
    const day = available.find((s) => /DAY|09|10/.test(s));
    if (day) return [day];
  }
  if (hasWord(lower, ['night','raat'], ['रात','रात्र'])) {
    const night = available.find((s) => /NIGHT|22|20/.test(s));
    if (night) return [night];
  }
  return [];
}

export class RuleBasedInterpreter implements VoiceInterpreter {
  readonly name = 'rule-based@1.0';

  async interpret(
    field: VoiceField, transcript: string, language: Language,
    context: InterpretContext = {},
  ): Promise<Interpretation> {
    const t = transcript.trim();
    const out = (value: Interpretation['value'], display: string, confidence: number): Interpretation =>
      ({ value, display, confidence, provider: this.name });

    if (!t) return out(null, '', 0);

    switch (field) {
      case 'confirm': {
        // Check NO first: "नाही" contains no Latin token, and "no" is a substring risk.
        if (hasWord(t.toLowerCase(), NO_LATIN, NO_DEV)) return out(false, t, 0.95);
        if (hasWord(t.toLowerCase(), YES_LATIN, YES_DEV)) return out(true, t, 0.95);
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
        // A Hindi/Marathi speaker says "औंध", but the table stores "Aundh".
        // Aliases for the seeded Pune localities bridge that; anything not
        // listed still resolves through the Latin matching below.
        const ALIAS: Record<string, string> = {
          'औंध':'aundh', 'बाणेर':'baner', 'कोथरूड':'kothrud', 'कोथरुड':'kothrud',
          'शिवाजीनगर':'shivajinagar', 'विमान नगर':'viman_nagar', 'विमाननगर':'viman_nagar',
          'हडपसर':'hadapsar', 'पिंपरी':'pimpri', 'डेक्कन':'deccan', 'डेक्कन जिमखाना':'deccan',
        };
        for (const [dev, key] of Object.entries(ALIAS)) {
          if (t.includes(dev)) {
            const hit = list.find((l) => l.key === key);
            if (hit) return out(hit.key, hit.display_name, 0.92);
          }
        }
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
          if (hasWord(t.toLowerCase(), ['fresher','no experience','none','naya'],
                      ['नया','नवीन','अनुभव नाही','कोई अनुभव नहीं','फ्रेशर'])) {
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

    // A script field. Handled by declared type rather than by name, so a new
    // role attribute needs no code here. Confidence stays below
    // CONFIRM_THRESHOLD throughout: without a model these are educated guesses
    // and the candidate should always get to correct them.
    const spec = context.spec;
    if (!spec) return out(null, t, 0.2);
    const lower = t.toLowerCase();

    if (spec.dataType === 'BOOL') {
      if (hasWord(lower, NO_LATIN, NO_DEV)) return out(false, t, 0.7);
      if (hasWord(lower, YES_LATIN, YES_DEV)) return out(true, t, 0.7);
      return out(null, t, 0.2);
    }

    if (spec.dataType === 'ENUM') {
      const hit = (spec.allowedValues ?? []).find((v) => {
        const words = v.toLowerCase().split('_').filter((w) => w.length > 2);
        return words.some((w) => lower.includes(w));
      });
      return hit ? out(hit, hit, 0.7) : out(null, t, 0.2);
    }

    if (spec.dataType === 'INT' || spec.dataType === 'MONEY_PAISE') {
      const n = parseNumber(t);
      return n === null ? out(null, t, 0.2) : out(n, String(n), 0.7);
    }

    // Free text is never inferred — read it back verbatim and let them confirm.
    return out(t, t, 0.5);
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
    context: InterpretContext = {},
  ): Promise<Interpretation> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return this.fallback.interpret(field, transcript, language, context);

    const schema: Record<string, string> = {
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
        content: `Field: ${field} (${schema[field] ?? context.spec?.expected ?? 'the value the question asked for'})\nSpeaker language: ${language}\nTranscript: ${JSON.stringify(transcript)}`,
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


/**
 * Gemini interpreter — the recommended upgrade over the rule-based one.
 *
 * Google's free tier is a permanent rate-limited tier rather than a trial
 * (10 requests/minute, 500/day on Flash, no card, no expiry), which comfortably
 * covers a demo doing roughly seven interpretations per candidate. It also
 * handles what rules cannot: unusual phrasing, code-switching mid-sentence, and
 * the Hinglish that frontline candidates actually speak.
 *
 * It cannot fix a bad transcript. If speech recognition mishears the word, no
 * interpreter downstream recovers it — that is a recognition problem, not a
 * comprehension one.
 */
export class GeminiInterpreter implements VoiceInterpreter {
  /** Free quota is per day AND per model, so this shares GEMINI_MODEL with the
   *  rubric scorer: one exhausted model must not silently take out both. */
  readonly model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  readonly name = this.model;
  private fallback = new RuleBasedInterpreter();

  async interpret(
    field: VoiceField, transcript: string, language: Language,
    context: InterpretContext = {},
  ): Promise<Interpretation> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return this.fallback.interpret(field, transcript, language, context);

    const expected: Record<string, string> = {
      name: 'the person\'s name, as a string',
      locality: `exactly one key from this list: ${(context.localities ?? []).map((l) => l.key).join(', ')}`,
      experienceMonths: 'total work experience as an integer number of MONTHS (convert years)',
      skills: 'an array of 1-6 UPPER_SNAKE_CASE skill tags',
      expectedPay: 'expected MONTHLY pay as an integer number of rupees (so "18 hazaar" is 18000)',
      commute: 'maximum one-way commute as an integer number of MINUTES',
      shifts: `an array of shift codes from: ${(context.shifts ?? []).join(', ')}`,
      confirm: 'true if they agreed, false if they disagreed',
    };

    const prompt =
      'You extract one field from a spoken answer by an Indian frontline job seeker. ' +
      'They speak English, Hindi or Marathi and often mix them. ' +
      `Field: ${field} — ${expected[field] ?? context.spec?.expected ?? 'the value the question asked for'}. Speaker language: ${language}.\n` +
      `Transcript: ${JSON.stringify(transcript)}\n` +
      'Return null for value and a low confidence when the answer is unclear, off-topic or absent. ' +
      'Never invent a value. "display" must be a short confirmation phrase in the speaker\'s own language.';

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  value: { type: 'STRING', nullable: true },
                  display: { type: 'STRING' },
                  confidence: { type: 'NUMBER' },
                },
                required: ['value', 'display', 'confidence'],
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = JSON.parse(text);
      if (parsed.value === null || parsed.value === undefined || parsed.value === '') {
        return { value: null, display: String(parsed.display ?? transcript), confidence: 0.2, provider: this.name };
      }
      // The schema returns a string; coerce to the shape saveProfile expects.
      const raw = String(parsed.value);
      let value: Interpretation['value'] = raw;
      if (field === 'experienceMonths' || field === 'expectedPay' || field === 'commute') {
        const n = Number(raw.replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(n)) return this.fallback.interpret(field, transcript, language, context);
        value = Math.round(n);
      } else if (field === 'skills' || field === 'shifts') {
        value = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      } else if (field === 'confirm') {
        value = /^(true|yes|1)$/i.test(raw);
      }
      return {
        value,
        display: String(parsed.display ?? raw),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        provider: this.name,
      };
    } catch {
      // Rate limit, outage or a malformed reply must not strand a candidate.
      return this.fallback.interpret(field, transcript, language, context);
    }
  }
}

/**
 * Preference order: a real model if one is configured, rules otherwise. Gemini
 * comes first because its free tier makes it the one a demo can actually turn
 * on without a billing account.
 */
export function voiceInterpreter(): VoiceInterpreter {
  if (process.env.GEMINI_API_KEY) return new GeminiInterpreter();
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeInterpreter();
  return new RuleBasedInterpreter();
}

/** Context the interpreter needs to resolve localities and shift codes. */
export async function interpreterContext() {
  const [localities, shifts] = await Promise.all([
    sql<{ key: string; display_name: string }[]>`SELECT key, display_name FROM app.locality ORDER BY display_name`,
    sql<{ shift: string }[]>`SELECT DISTINCT shift FROM app.job WHERE status='LIVE'`,
  ]);
  return { localities, shifts: ['ANY', ...shifts.map((s) => s.shift)] };
}
