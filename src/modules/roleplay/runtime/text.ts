/**
 * Language utilities shared by the runtime and the rule evidence extractor.
 *
 * Offsets are Unicode code points, start inclusive and end exclusive (spec §14).
 * JavaScript strings index UTF-16 code units, so every conversion goes through
 * these helpers; an emoji or a Devanagari conjunct must never shift a citation.
 */

export const codePoints = (s: string) => Array.from(s);
export const cpLength = (s: string) => codePoints(s).length;
export const cpSlice = (s: string, start: number, end: number) => codePoints(s).slice(start, end).join('');

/** Code-point offset of `needle` in `hay`, or -1. */
export function cpIndexOf(hay: string, needle: string, from = 0): number {
  const unitFrom = codePoints(hay).slice(0, from).join('').length;
  const unit = hay.indexOf(needle, unitFrom);
  return unit < 0 ? -1 : cpLength(hay.slice(0, unit));
}

export interface Sentence { text: string; start: number; end: number }

/** Sentence-ish clauses with code-point offsets. Question marks stay attached. */
export function sentences(text: string): Sentence[] {
  const cps = codePoints(text);
  const out: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start; let e = end;
    while (s < e && /\s/.test(cps[s])) s++;
    while (e > s && /\s/.test(cps[e - 1])) e--;
    if (e > s) out.push({ text: cps.slice(s, e).join(''), start: s, end: e });
  };
  for (let i = 0; i < cps.length; i++) {
    // A dot between digits is a decimal ("3.5 lakh"), not a sentence end.
    if (cps[i] === '.' && /\d/.test(cps[i - 1] ?? '') && /\d/.test(cps[i + 1] ?? '')) continue;
    if ('.!?।\n'.includes(cps[i])) {
      // keep "..." and "?!" together
      let j = i; while (j + 1 < cps.length && '.!?'.includes(cps[j + 1])) j++;
      push(j + 1); start = j + 1; i = j;
    }
  }
  push(cps.length);
  return out;
}

const WH = /^(what|which|when|where|who|whom|whose|why|how|is|are|was|were|do|does|did|has|have|had|can|could|would|will|shall|should|may|might|any|tell me|could you|would you|can you)\b/i;
/** A sentence that asks something, as opposed to one that merely mentions a topic. */
export function isQuestion(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (s.endsWith('?')) return true;
  // "I'd like to understand ..." / "Please tell me ..." ask without a question mark.
  return WH.test(s) || /^(please\s+)?(tell|share|explain|help me understand|let me understand|i('d| would) like to (know|understand))\b/i.test(s);
}

const NEG = /\b(not|no|never|cannot|can'?t|won'?t|don'?t|doesn'?t|isn'?t|aren'?t|shouldn'?t|wouldn'?t|without|nobody|nothing)\b/i;
export function isNegatedBefore(sentence: string, cpIndex: number, window = 8): boolean {
  const before = cpSlice(sentence, 0, cpIndex).replace(/[’]/g, "'");
  const words = before.split(/\s+/).filter(Boolean).slice(-window).join(' ');
  return NEG.test(words);
}
/** The sentence attributes the claim to someone else, or quotes it. */
export function isAttributedOrQuoted(sentence: string): boolean {
  return /["“”‘]/.test(sentence) || /\b(someone|somebody|they|he|she|another (bank|agent|person)|other (banks|agents))\s+(said|told|promised|claimed|says|tells|promises)\b/i.test(sentence)
    || /\b(did|has|have)\s+(someone|anyone|somebody|anybody|they)\b/i.test(sentence);
}
export function isHypothetical(sentence: string): boolean {
  return /^(if|suppose|imagine|what if|even if)\b/i.test(sentence.trim()) || /\b(for example|for instance|such as saying)\b/i.test(sentence);
}

// ---- lexical similarity for the deterministic (mock) classifier -------------

const STOP = new Set(('a an the is are was were be been being am i you your yours we our ours they their them she her he his it its this that these those ' +
  'to of for in on at by with from about as into and or but so if then than there here do does did have has had can could would should will shall may might ' +
  'please me my mine us just also any some very really kindly sir madam ji okay ok let tell know like want need get got going go take').split(' '));
const WH_KEEP = new Set(['what', 'which', 'when', 'where', 'who', 'whom', 'why', 'how', 'much', 'many']);

/** Light stemming: enough to equate "approved/approval/approve" and "payments/payment". */
export function stem(w: string): string {
  let s = w.toLowerCase().replace(/[’']/g, '');
  for (const suf of ['ational', 'ations', 'ation', 'ments', 'ment', 'ingly', 'ings', 'ing', 'edly', 'ied', 'ies', 'ed', 'ly', 'al', 'es', 's', 'e']) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

export function contentWords(text: string, keepWh = true): string[] {
  const words = text.toLowerCase().replace(/[’']/g, '').match(/[\p{L}\p{N}₹]+/gu) ?? [];
  return words.filter((w) => (keepWh && WH_KEEP.has(w)) || (!STOP.has(w) && !WH_KEEP.has(w))).map(stem);
}

/**
 * Share of the example's content words present in the text. A pure keyword
 * count cannot tell asking from mentioning, which is why callers also check
 * question form and negation.
 */
export function coverage(example: string, text: string): { score: number; matched: number; total: number; topic: number } {
  const ex = Array.from(new Set(contentWords(example)));
  if (!ex.length) return { score: 0, matched: 0, total: 0, topic: 0 };
  const have = new Set(contentWords(text));
  const hits = ex.filter((w) => have.has(w));
  // Question words make "how much does it cost" and "how much loan" look alike;
  // a match must share at least one topic word, not just the question form.
  const topic = hits.filter((w) => !WH_KEEP.has(w)).length;
  if (!topic) return { score: 0, matched: 0, total: ex.length, topic: 0 };
  return { score: hits.length / ex.length, matched: hits.length, total: ex.length, topic };
}

/** Locate the first sentence of `text` whose words best cover `example`. */
export function bestSentence(example: string, text: string): { sentence: Sentence; score: number; matched: number } | null {
  let best: { sentence: Sentence; score: number; matched: number } | null = null;
  for (const s of sentences(text)) {
    const c = coverage(example, s.text);
    if (!best || c.score > best.score) best = { sentence: s, score: c.score, matched: c.matched };
  }
  return best;
}
