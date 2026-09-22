import type { Language } from './voice';

/**
 * Rubric scorer for open spoken answers (role scripts).
 *
 * The multiple-choice assessment grades by string equality. That cannot grade
 * "what would you do if the customer is not answering their phone", which is
 * the kind of question a human screener actually asks. This adapter scores such
 * an answer against a written rubric.
 *
 * Same shape as the voice adapter: an interface, a zero-cost deterministic
 * implementation used by default, and a model-backed one that engages only when
 * configured. A model outage degrades to keywords; it never strands a candidate.
 *
 * Everything needed to argue with a score is returned and stored: which rubric
 * credits were awarded, why, which scorer decided, and how sure it was. A score
 * whose provenance cannot be shown is not a score.
 */

export interface RubricCredit {
  /** What earns these points, in plain language. Shown to operations. */
  credit: string;
  points: number;
}

export interface SkillTurn {
  key: string;
  maxScore: number;
  rubricVersion: string;
  ask: Record<Language, string>;
  rubric: RubricCredit[];
}

export interface SkillScore {
  score: number;
  maxScore: number;
  /** The rubric credits judged to be met, verbatim from the rubric. */
  credits: string[];
  reasoning: string;
  /** 0–1. Below REVIEW_THRESHOLD the score is flagged for a human. */
  confidence: number;
  scorer: string;
}

export interface SkillScorer {
  readonly name: string;
  score(turn: SkillTurn, transcript: string, language: Language): Promise<SkillScore>;
}

/** Below this, a score is surfaced for review rather than taken at face value. */
export const REVIEW_THRESHOLD = 0.6;

/** Keyword scoring is a fallback, never authoritative. Capped below review. */
const KEYWORD_MAX_CONFIDENCE = 0.5;

const clampScore = (n: number, max: number) =>
  Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Deterministic fallback. Matches the significant words of each rubric credit
 * against the transcript.
 *
 * It is genuinely weak — it cannot tell "I would refuse the money" from "I would
 * not refuse the money" — which is exactly why its confidence is capped below
 * REVIEW_THRESHOLD so every keyword-scored answer is flagged for a human.
 */
export class KeywordSkillScorer implements SkillScorer {
  readonly name = 'keyword@1.0';

  private static STOP = new Set([
    'the','a','an','and','or','not','is','it','to','of','for','their','them','they',
    'does','do','without','back','than','that','this','with','from','into','about',
  ]);

  /** `cause` explains why this ran instead of a model, so the flag is actionable. */
  async score(turn: SkillTurn, transcript: string, _language: Language,
              cause = 'No model was configured'): Promise<SkillScore> {
    const text = transcript.toLowerCase();
    if (!text.trim()) {
      return { score: 0, maxScore: turn.maxScore, credits: [], confidence: 0,
               reasoning: 'No answer was given.', scorer: this.name };
    }

    const credits: string[] = [];
    let earned = 0;
    for (const c of turn.rubric) {
      const words = c.credit.toLowerCase().split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !KeywordSkillScorer.STOP.has(w));
      if (!words.length) continue;
      const hits = words.filter((w) => text.includes(w)).length;
      // Half the significant words is a deliberately blunt bar; this scorer
      // exists to keep the journey moving, not to be right.
      if (hits / words.length >= 0.5) { credits.push(c.credit); earned += c.points; }
    }

    return {
      score: clampScore(earned, turn.maxScore),
      maxScore: turn.maxScore,
      credits,
      confidence: KEYWORD_MAX_CONFIDENCE,
      reasoning: credits.length
        ? `Keyword match only (${cause}). Words from these rubric credits appeared: ${credits.join('; ')}. Needs review.`
        : `Keyword match only (${cause}). No rubric credit matched. Needs review.`,
      scorer: this.name,
    };
  }
}


/** Free-tier quotas are per-minute, so a burst trips them; one retry clears it. */
const RETRY_AFTER_MS = 3500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (status: number) => status === 429 || status >= 500;

/** Shared prompt. The rubric travels verbatim so the model grades the real thing. */
function buildPrompt(turn: SkillTurn, transcript: string, language: Language): string {
  const rubric = turn.rubric
    .map((c, i) => `${i + 1}. "${c.credit}" — worth ${c.points} point(s)`)
    .join('\n');
  return [
    'You are grading one spoken answer from an Indian frontline job applicant.',
    'They may answer in English, Hindi or Marathi, or mix them. Judge what they MEAN, not their wording or grammar.',
    '',
    `Question asked: ${turn.ask[language] ?? turn.ask.en}`,
    `They said: ${JSON.stringify(transcript)}`,
    '',
    `Rubric (total ${turn.maxScore}):`,
    rubric,
    '',
    'Award each credit only if the answer actually shows it. Do not give credit for',
    'something they did not say. If the answer is empty, off-topic, or too unclear to',
    'judge, return score 0, credits [], confidence 0, and say so in reasoning.',
    'Never invent what they might have meant.',
    '',
    'Reply with ONLY this JSON:',
    '{"score": <integer 0-' + turn.maxScore + '>, "credits": [<exact credit strings you awarded>], "reasoning": "<one or two sentences>", "confidence": <0-1>}',
  ].join('\n');
}

function coerce(raw: unknown, turn: SkillTurn, scorer: string): SkillScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.score !== 'number') return null;
  const valid = new Set(turn.rubric.map((c) => c.credit));
  return {
    score: clampScore(r.score, turn.maxScore),
    maxScore: turn.maxScore,
    // Only credits that exist in the rubric survive — a model cannot invent one.
    credits: Array.isArray(r.credits) ? r.credits.filter((c): c is string => typeof c === 'string' && valid.has(c)) : [],
    reasoning: typeof r.reasoning === 'string' ? r.reasoning.slice(0, 600) : '',
    confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
    scorer,
  };
}

/**
 * Gemini. Free tier, which is what makes this demonstrable at all.
 *
 * The free quota is per DAY and per MODEL, and it is small — 2.5-flash allows
 * 20 generate calls a day, which is roughly six scored runs. flash-lite carries
 * its own separate allowance and is more than capable of grading against an
 * explicit rubric, so it is the default; GEMINI_MODEL overrides it.
 */
export class GeminiSkillScorer implements SkillScorer {
  readonly model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  readonly name = this.model;
  private fallback = new KeywordSkillScorer();

  async score(turn: SkillTurn, transcript: string, language: Language): Promise<SkillScore> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return this.fallback.score(turn, transcript, language);

    const call = () => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(turn, transcript, language) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            // Grading against an explicit rubric does not need extended
            // reasoning, and the thinking tokens were pushing past the timeout
            // on exactly the nuanced answers this is here to judge.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(12000),
      },
    );

    try {
      let res = await call();
      if (transient(res.status)) { await sleep(RETRY_AFTER_MS); res = await call(); }
      if (!res.ok) {
        const why = res.status === 429
          ? `${this.model} free-tier quota exhausted (the allowance is per day, per model)`
          : `${this.model} returned HTTP ${res.status}`;
        return this.fallback.score(turn, transcript, language, why);
      }
      const body = await res.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = coerce(JSON.parse(String(text)), turn, this.name);
      return parsed ?? await this.fallback.score(turn, transcript, language, `${this.model} returned an unreadable response`);
    } catch (e) {
      const why = e instanceof Error && e.name === 'TimeoutError' ? `${this.model} timed out` : `${this.model} was unreachable`;
      return this.fallback.score(turn, transcript, language, why);
    }
  }
}

/** Claude, for a deployment that already pays for it. */
export class ClaudeSkillScorer implements SkillScorer {
  readonly name = 'claude-sonnet-5';
  private fallback = new KeywordSkillScorer();

  async score(turn: SkillTurn, transcript: string, language: Language): Promise<SkillScore> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return this.fallback.score(turn, transcript, language);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 400,
          messages: [{ role: 'user', content: buildPrompt(turn, transcript, language) }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return this.fallback.score(turn, transcript, language);
      const body = await res.json();
      const text = body?.content?.[0]?.text;
      const parsed = coerce(JSON.parse(String(text)), turn, this.name);
      return parsed ?? await this.fallback.score(turn, transcript, language);
    } catch {
      return this.fallback.score(turn, transcript, language);
    }
  }
}

/**
 * Preference order mirrors voiceInterpreter(): Gemini first, because its free
 * tier is the one a demo can switch on without a billing account.
 */
export function skillScorer(): SkillScorer {
  if (process.env.GEMINI_API_KEY) return new GeminiSkillScorer();
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeSkillScorer();
  return new KeywordSkillScorer();
}

/** A score needs a human look when the model was unsure, or no model ran. */
export const needsReview = (s: SkillScore) =>
  s.confidence < REVIEW_THRESHOLD || s.scorer === 'keyword@1.0';
