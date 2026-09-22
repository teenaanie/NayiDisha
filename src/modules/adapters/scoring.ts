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

  async score(turn: SkillTurn, transcript: string, _language: Language): Promise<SkillScore> {
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
        ? `Keyword match only. Words from these rubric credits appeared: ${credits.join('; ')}. No model was available, so this needs review.`
        : 'Keyword match only. No rubric credit matched. No model was available, so this needs review.',
      scorer: this.name,
    };
  }
}

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

/** Gemini 2.5 Flash. Free tier, which is what makes this demonstrable at all. */
export class GeminiSkillScorer implements SkillScorer {
  readonly name = 'gemini-2.5-flash';
  private fallback = new KeywordSkillScorer();

  async score(turn: SkillTurn, transcript: string, language: Language): Promise<SkillScore> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return this.fallback.score(turn, transcript, language);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(turn, transcript, language) }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) return this.fallback.score(turn, transcript, language);
      const body = await res.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = coerce(JSON.parse(String(text)), turn, this.name);
      return parsed ?? await this.fallback.score(turn, transcript, language);
    } catch {
      return this.fallback.score(turn, transcript, language);
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
