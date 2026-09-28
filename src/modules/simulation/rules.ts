/**
 * Deterministic core of sales practice: the rule-based customer, the evidence
 * checks the evaluator trusts over any model, and the coaching report.
 *
 * No database and no network here, so scripts/simulation-eval-check.ts can run
 * fixture transcripts through exactly the code the app uses.
 */

export type Lang = 'en' | 'hi' | 'mr' | 'ta' | 'te' | 'kn' | 'bn' | 'gu' | 'ml' | 'pa' | 'od';
type Localised = Partial<Record<Lang, string>> & { en: string };
export const pick = (l: Localised, lang: Lang) => l[lang] ?? l.en;

export interface Fact {
  key: string;
  label: string;
  value: string;
  good_question: string;
  reveal_when: string;
  keywords: string[];
  reply: Localised;
}
export interface Dimension {
  key: string; label: string;
  excellent: string; acceptable: string; poor: string;
  evidence_keys: string[];
}
export interface RiskRule { key: string; label: string; patterns: string[] }
export interface Band { min: number; label: string }

export interface Scenario {
  id: string; version: string; title: string; product: string; skill: string;
  difficulty: string; durationMin: number; maxTurns: number; learnerRole: string;
  learnerBrief: Localised; openingLine: Localised;
  customerProfile: Record<string, string>;
  facts: Fact[]; pitchDeflection: Localised;
  rubric: Dimension[]; riskRules: RiskRule[]; bands: Band[];
}

export interface Turn {
  seq: number;
  speaker: 'LEARNER' | 'CUSTOMER';
  text: string;
  /** English rendering; null when no translator ran. */
  textEn: string | null;
  revealedKeys: string[];
}

// ---------------------------------------------------------------------------
// Reading what the learner said
// ---------------------------------------------------------------------------

const lower = (s: string) => s.toLowerCase();
/** Both renderings are searched: the original catches Devanagari keywords, the translation everything else. */
const texts = (t: Pick<Turn, 'text' | 'textEn'>) => [lower(t.text), lower(t.textEn ?? '')].filter(Boolean);

export function factsMentioned(scenario: Scenario, turn: Pick<Turn, 'text' | 'textEn'>): string[] {
  const hay = texts(turn);
  return scenario.facts
    .filter((f) => f.keywords.some((k) => hay.some((h) => h.includes(lower(k)))))
    .map((f) => f.key);
}

const QUESTION_START = /^(what|which|when|where|who|whom|how|has|have|had|is|are|was|were|do|does|did|can|could|would|will|shall|should|may|any|tell me|could you|क्या|कब|कहाँ|कितना|कितनी|कितने|कौन|कैसे|किस|काय|कधी|कुठे|किती|कोण|कसे|कसा|कोणत)/;
export function isQuestion(turn: Pick<Turn, 'text' | 'textEn'>): boolean {
  return texts(turn).some((t) => t.includes('?') || t.split(/[.!।]\s*/).some((s) => QUESTION_START.test(s.trim())));
}

const PITCH = [
  'interest rate', 'rate of interest', 'our loan', 'our education loan', 'we offer', 'we provide', 'we have a',
  'scheme', 'processing fee', 'tenure', 'apply now', 'apply today', 'fill the application', 'submit the documents',
  'documents required', 'documents needed', 'send me your documents', 'emi will be', 'emi would be',
  'you are eligible', 'sanction', 'disburse', 'best product', 'special offer',
  'ब्याज दर', 'हमारी योजना', 'दस्तावेज़ भेज', 'व्याज दर', 'आमची योजना', 'कागदपत्रे पाठव',
];
export function isPitch(turn: Pick<Turn, 'text' | 'textEn'>): boolean {
  const hay = texts(turn);
  return PITCH.some((p) => hay.some((h) => h.includes(p)));
}

/** A pitch counts as early until the learner has asked about this many distinct facts. */
export const DISCOVERY_BEFORE_PITCH = 4;

// ---------------------------------------------------------------------------
// Rule-based customer (used when no model is configured, or a model fails)
// ---------------------------------------------------------------------------

const AS_I_SAID: Localised = { en: 'As I said, ', hi: 'जैसा मैंने बताया, ', mr: 'मी म्हटल्याप्रमाणे, ' };
const IDLE: Localised[] = [
  { en: 'Hmm. I just want to know whether this is the right choice for us.', hi: 'हम्म। मैं बस यह जानना चाहता हूँ कि यह हमारे लिए सही है या नहीं।', mr: 'हं. हे आमच्यासाठी योग्य आहे का एवढंच मला जाणून घ्यायचं आहे.' },
  { en: 'Okay. What else do you need to know from me?', hi: 'ठीक है। आपको मुझसे और क्या जानना है?', mr: 'ठीक आहे. तुम्हाला माझ्याकडून आणखी काय जाणून घ्यायचं आहे?' },
  { en: 'I see. I am still not sure how much we will need.', hi: 'अच्छा। मुझे अभी भी पक्का नहीं कि हमें कितना चाहिए होगा।', mr: 'बरं. आम्हाला नक्की किती लागेल हे अजून मला कळत नाही.' },
];

export interface CustomerReply { reply: string; revealedKeys: string[]; pitchedEarly: boolean }

export function ruleCustomerReply(
  scenario: Scenario, lang: Lang, learner: Pick<Turn, 'text' | 'textEn'>,
  alreadyRevealed: string[], askedSoFar: number, turnIndex: number,
): CustomerReply {
  const mentioned = factsMentioned(scenario, learner);
  const pitchedEarly = isPitch(learner) && !isQuestion(learner) && askedSoFar < DISCOVERY_BEFORE_PITCH;
  if (pitchedEarly) return { reply: pick(scenario.pitchDeflection, lang), revealedKeys: [], pitchedEarly };

  // The doc's worked example: "how much loan do you need?" earns the vague
  // answer, never the full breakdown.
  if (!mentioned.length && /loan amount|how much loan|कितना लोन|किती लोन|किती कर्ज/i.test(learner.text + ' ' + (learner.textEn ?? ''))) {
    const vague: Localised = { en: 'We are not sure. The course is around ₹14 lakh, but we have some savings.', hi: 'पक्का नहीं पता। कोर्स लगभग 14 लाख का है, पर हमारे पास कुछ बचत है।', mr: 'नक्की माहीत नाही. अभ्यासक्रम सुमारे १४ लाखांचा आहे, पण आमच्याकडे थोडी बचत आहे.' };
    // Nothing is marked revealed: the learner asked for a loan amount, not the
    // cost, so the rough figure is volunteered and earns no discovery credit.
    return { reply: pick(vague, lang), revealedKeys: [], pitchedEarly: false };
  }

  const fresh = mentioned.filter((k) => !alreadyRevealed.includes(k)).slice(0, 2);
  if (fresh.length) {
    const replies = fresh.map((k) => pick(scenario.facts.find((f) => f.key === k)!.reply, lang));
    return { reply: replies.join(' '), revealedKeys: fresh, pitchedEarly: false };
  }
  if (mentioned.length) {
    const f = scenario.facts.find((x) => x.key === mentioned[0])!;
    return { reply: pick(AS_I_SAID, lang) + pick(f.reply, lang), revealedKeys: [], pitchedEarly: false };
  }
  return { reply: pick(IDLE[turnIndex % IDLE.length], lang), revealedKeys: [], pitchedEarly: false };
}

// ---------------------------------------------------------------------------
// Evaluator evidence — the parts a rule can decide better than a model
// ---------------------------------------------------------------------------

export interface Coverage { key: string; label: string; asked: boolean; turnSeq: number | null; revealed: boolean }
export interface RiskFlag { rule: string; label: string; quote: string; turnSeq: number }
export interface DimensionScore { key: string; label: string; score: number; evidence: string }

export interface Evidence {
  coverage: Coverage[];
  riskFlags: RiskFlag[];
  pitchedEarly: boolean;
  firstPitchSeq: number | null;
  learnerTurns: number;
  checksUnderstanding: boolean;
  jargon: string[];
  explainsAssessment: boolean;
}

/**
 * "Approval is not guaranteed" is exactly what a responsible officer says, so a
 * risk phrase only counts when nothing earlier in the same sentence negates it.
 */
const NEGATION = /\b(not|no|never|cannot|can['’]?t|won['’]?t|don['’]?t|nahi|nahin)\b|नहीं|नाही/i;
function riskyIn(text: string, patterns: RegExp[]): boolean {
  for (const clause of text.split(/[.!?।\n,;]+/)) {
    for (const re of patterns) {
      const m = re.exec(clause);
      // Negation only counts close to the phrase: "don't worry about documents,
      // it will definitely be approved" is still a promise.
      if (m && !NEGATION.test(clause.slice(Math.max(0, m.index - 30), m.index))) return true;
    }
  }
  return false;
}

const HARD_RISKS = new Set(['guaranteed_approval', 'promised_amount', 'misstate_income']);
/** A promise of approval or an amount, or misstating income: never acceptable, whatever the total. */
export const hasHardRisk = (ev: Evidence) => ev.riskFlags.some((f) => HARD_RISKS.has(f.rule));
const JARGON = ['moratorium', 'ltv', 'foir', 'cibil', 'collateral', 'margin money', 'sanction', 'disbursement', 'roi', 'amortis', 'amortiz', 'hypothecation'];
const EXPLAINS = /(means|that is|in simple|i\.e\.|matlab|यानी|म्हणजे|मतलब)/;
const CHECKS = /(does that make sense|is that clear|any questions|do you understand|shall i explain|would you like me to explain|समझ आया|समझ गए|कळलं|समजलं|समजलं का)/;
const ASSESSMENT = /(depends on|subject to|after (the )?assessment|eligibility check|cannot promise|can'?t promise|not guaranteed|bank will assess|निर्भर|अवलंबून)/;

export function gatherEvidence(scenario: Scenario, turns: Turn[]): Evidence {
  const learner = turns.filter((t) => t.speaker === 'LEARNER');
  const coverage: Coverage[] = scenario.facts.map((f) => ({ key: f.key, label: f.label, asked: false, turnSeq: null, revealed: false }));
  const byKey = new Map(coverage.map((c) => [c.key, c]));
  let firstPitchSeq: number | null = null;
  let pitchedEarly = false;

  for (const t of turns) {
    if (t.speaker === 'CUSTOMER') { for (const k of t.revealedKeys) { const c = byKey.get(k); if (c) c.revealed = true; } continue; }
    const reply = turns.find((x) => x.seq === t.seq + 1 && x.speaker === 'CUSTOMER');
    // Credit only what the learner went after: a keyword in their own words, or
    // a fact the customer gave in direct answer to their question. Anything the
    // customer volunteered to a statement earns nothing.
    // Only a turn that asks something is discovery: "don't worry, it is pakka"
    // mentions worry and confirmation but asks about neither.
    const asking = isQuestion(t);
    const credited = new Set(asking ? factsMentioned(scenario, t) : []);
    if (reply && asking) for (const k of reply.revealedKeys) credited.add(k);
    const askedBefore = coverage.filter((c) => c.asked).length;
    if (isPitch(t) && !isQuestion(t) && firstPitchSeq === null) {
      firstPitchSeq = t.seq;
      if (askedBefore < DISCOVERY_BEFORE_PITCH) pitchedEarly = true;
    }
    for (const k of credited) { const c = byKey.get(k); if (c && !c.asked) { c.asked = true; c.turnSeq = t.seq; } }
  }

  const riskFlags: RiskFlag[] = [];
  for (const t of learner) {
    for (const rule of scenario.riskRules) {
      const res = rule.patterns.map((p) => new RegExp(p, 'i'));
      if ([t.text, t.textEn ?? ''].some((s) => riskyIn(s, res))) {
        riskFlags.push({ rule: rule.key, label: rule.label, quote: t.text.slice(0, 240), turnSeq: t.seq });
      }
    }
  }

  const all = learner.map((t) => lower(t.text + ' ' + (t.textEn ?? ''))).join(' \n ');
  const jargon = JARGON.filter((j) => all.includes(j) && !EXPLAINS.test(all));
  return {
    coverage, riskFlags, pitchedEarly, firstPitchSeq,
    learnerTurns: learner.length,
    checksUnderstanding: CHECKS.test(all),
    jargon,
    explainsAssessment: ASSESSMENT.test(all),
  };
}

const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(Number.isFinite(n) ? n : 1)));

/** Below this many learner turns there is too little to judge conduct well; scores cap at "acceptable". */
const MIN_TURNS_FOR_CREDIT = 3;

/** Rubric scores from evidence alone. Honest but blunt, so always flagged for review. */
export function ruleScores(scenario: Scenario, ev: Evidence): DimensionScore[] {
  const thin = ev.learnerTurns < MIN_TURNS_FOR_CREDIT;
  return rawRuleScores(scenario, ev).map((d) =>
    thin && (d.key === 'responsible' || d.key === 'clarity') && d.score > 3
      ? { ...d, score: 3, evidence: d.evidence + ' Too short a conversation to score higher.' } : d);
}

function rawRuleScores(scenario: Scenario, ev: Evidence): DimensionScore[] {
  const asked = new Set(ev.coverage.filter((c) => c.asked).map((c) => c.key));
  const label = (k: string) => scenario.facts.find((f) => f.key === k)?.label.toLowerCase() ?? k;
  return scenario.rubric.map((d) => {
    if (d.evidence_keys.length) {
      const hit = d.evidence_keys.filter((k) => asked.has(k));
      const miss = d.evidence_keys.filter((k) => !asked.has(k));
      const score = clamp5(1 + (4 * hit.length) / d.evidence_keys.length);
      return {
        key: d.key, label: d.label, score,
        evidence: (hit.length ? `Asked about ${hit.map(label).join(', ')}.` : 'Did not ask about any of these areas.') +
          (miss.length ? ` Missed ${miss.map(label).join(', ')}.` : ''),
      };
    }
    if (d.key === 'sequencing') {
      const score = ev.learnerTurns === 0 ? 1 : ev.pitchedEarly ? 1 : ev.firstPitchSeq === null ? (asked.size >= 6 ? 5 : asked.size >= 3 ? 4 : 2) : 4;
      return { key: d.key, label: d.label, score, evidence: ev.pitchedEarly ? 'Explained the product before understanding the need.' : ev.firstPitchSeq === null ? `Stayed in discovery; asked about ${asked.size} areas.` : 'Explored the need before explaining the product.' };
    }
    if (d.key === 'responsible') {
      const hard = ev.riskFlags.filter((f) => HARD_RISKS.has(f.rule));
      const score = hard.length ? 1 : ev.riskFlags.length ? 3 : ev.explainsAssessment ? 5 : 4;
      return { key: d.key, label: d.label, score, evidence: ev.riskFlags.length ? `Risky statement: ${ev.riskFlags.map((f) => f.label.toLowerCase()).join(', ')}.` : ev.explainsAssessment ? 'Made clear that approval depends on assessment.' : 'Made no guarantees, but did not say approval depends on assessment.' };
    }
    // clarity: 5 needs both simple language and a check that the customer understood.
    const score = ev.learnerTurns === 0 ? 1 : clamp5(2 + (ev.checksUnderstanding ? 2 : 0) + (ev.jargon.length === 0 ? 1 : 0) - (ev.jargon.length >= 2 ? 1 : 0));
    return { key: d.key, label: d.label, score, evidence: `${ev.checksUnderstanding ? 'Checked the customer understood.' : 'Did not check understanding.'} ${ev.jargon.length ? 'Unexplained terms: ' + ev.jargon.join(', ') + '.' : 'No unexplained jargon.'}` };
  });
}

/**
 * Where a rule and a model disagree about something a rule can see, the rule
 * bounds the model: coverage may move one point either way, and a hard
 * compliance breach caps responsible selling at 1 whatever the model thought.
 */
export function reconcile(rule: DimensionScore[], model: DimensionScore[] | null, scenario: Scenario, ev: Evidence): DimensionScore[] {
  if (!model) return rule;
  return scenario.rubric.map((d) => {
    const r = rule.find((x) => x.key === d.key)!;
    const m = model.find((x) => x.key === d.key);
    if (!m) return r;
    let score = clamp5(m.score);
    if (d.evidence_keys.length) score = Math.max(r.score - 1, Math.min(r.score + 1, score));
    if (d.key === 'responsible' && ev.riskFlags.some((f) => HARD_RISKS.has(f.rule))) score = 1;
    return { key: d.key, label: d.label, score, evidence: m.evidence || r.evidence };
  });
}

export const bandFor = (scenario: Scenario, total: number) =>
  [...scenario.bands].sort((a, b) => b.min - a.min).find((b) => total >= b.min)?.label ?? scenario.bands[scenario.bands.length - 1].label;

// ---------------------------------------------------------------------------
// Coach — turns scores into something a learner can act on
// ---------------------------------------------------------------------------

export interface Report {
  strengths: string[];
  improvements: string[];
  bestMoment: string | null;
  missedOpportunity: string | null;
  retry: { focus: string; instruction: string; questions: string[] };
}

/** Facts in the order a good discovery conversation would usually reach them. */
const PRIORITY = ['total_cost', 'savings', 'scholarship', 'deadline', 'repayment_concern', 'admission', 'course', 'institution', 'co_borrower', 'moratorium', 'savings_vs_loan'];

export function ruleReport(scenario: Scenario, ev: Evidence, dims: DimensionScore[], turns: Turn[]): Report {
  const fact = (k: string) => scenario.facts.find((f) => f.key === k)!;
  const asked = ev.coverage.filter((c) => c.asked);
  const missed = PRIORITY.filter((k) => scenario.facts.some((f) => f.key === k)).filter((k) => !asked.some((c) => c.key === k));

  const strengths: string[] = [];
  if (asked.length) strengths.push(`You asked about ${asked.slice(0, 4).map((c) => c.label.toLowerCase()).join(', ')}.`);
  if (!ev.riskFlags.length) strengths.push('You avoided promising approval or a loan amount.');
  if (!ev.pitchedEarly && ev.learnerTurns > 0) strengths.push('You explored the need before explaining the product.');
  if (ev.checksUnderstanding) strengths.push('You checked that the customer understood.');

  const improvements: string[] = [];
  for (const k of missed.slice(0, 3)) improvements.push(`You did not ask about ${fact(k).label.toLowerCase()}. Try: “${fact(k).good_question}”`);
  if (ev.pitchedEarly) improvements.push('You explained the loan before understanding the family’s funding need.');
  for (const f of ev.riskFlags.slice(0, 2)) improvements.push(`Avoid statements like “${f.quote.slice(0, 80)}”: ${f.label.toLowerCase()} is a compliance risk.`);
  if (ev.jargon.length) improvements.push(`Explain terms such as ${ev.jargon.join(', ')} in simple words.`);

  // Best moment: the learner question that opened up the most.
  let bestMoment: string | null = null;
  let best = 0;
  for (const t of turns.filter((x) => x.speaker === 'LEARNER')) {
    const n = ev.coverage.filter((c) => c.turnSeq === t.seq).length;
    if (n > best) { best = n; bestMoment = `You asked, “${t.text.slice(0, 160)}” This drew out ${ev.coverage.filter((c) => c.turnSeq === t.seq).map((c) => c.label.toLowerCase()).join(' and ')}.`; }
  }

  // Missed opportunity: a concern the customer raised that was never followed up.
  const concernRaised = ev.coverage.find((c) => c.key === 'repayment_concern')?.revealed;
  const followed = ev.coverage.find((c) => c.key === 'moratorium')?.asked || ev.coverage.find((c) => c.key === 'savings_vs_loan')?.asked;
  const missedOpportunity = concernRaised && !followed
    ? 'When the customer said EMI was a concern, you could have asked: “What monthly repayment range would feel manageable after the course?”'
    : missed[0] ? `You could have asked: “${fact(missed[0]).good_question}”` : null;

  const weakest = [...dims].sort((a, b) => a.score - b.score)[0];
  const retryQuestions = missed.slice(0, 3).map((k) => fact(k).good_question);
  return {
    strengths, improvements, bestMoment, missedOpportunity,
    retry: {
      focus: weakest?.label ?? 'Discovery',
      instruction: retryQuestions.length
        ? `Repeat the discovery stage. This time, ask these before explaining the loan: ${missed.slice(0, 3).map((k) => fact(k).label.toLowerCase()).join(', ')}.`
        : 'Repeat the conversation and summarise the family’s need back to them before explaining any product.',
      questions: retryQuestions,
    },
  };
}
