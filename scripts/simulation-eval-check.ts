/**
 * Calibration check for the sales-practice evaluator.
 *
 * Runs fixture transcripts for the education-loan scenario through the real
 * evaluator and asserts the doc's bands: a strong discovery conversation scores
 * 25+, a weak one (loan amount only, early pitch) scores under 13, a risky one
 * is flagged, and facts the customer volunteers earn no credit.
 *
 * No database: the scenario is read straight from its migration, so this runs
 * anywhere. With no model keys it checks the rules alone; with ANTHROPIC_API_KEY,
 * GEMINI_API_KEY or SARVAM_API_KEY set it checks the model path as well.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/simulation-eval-check.ts [--rules-only]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario, Turn } from '../src/modules/simulation/rules';
import { gatherEvidence, ruleScores, ruleCustomerReply, bandFor } from '../src/modules/simulation/rules';

function scenarioFromMigration(): Scenario {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/013_sales_simulation.sql'), 'utf8');
  const start = sql.indexOf('INSERT INTO app.simulation_scenario');
  const body = sql.slice(sql.indexOf('VALUES', start), sql.indexOf(');', sql.indexOf('VALUES', start)));
  const literals: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "'") continue;
    let s = '';
    for (i++; i < body.length; i++) {
      if (body[i] === "'" && body[i + 1] === "'") { s += "'"; i++; } else if (body[i] === "'") break; else s += body[i];
    }
    literals.push(s);
  }
  const [id, version, title, product, skill, difficulty, learnerRole, brief, opening, profile, facts, deflection, rubric, risks, bands] = literals;
  return {
    id, version, title, product, skill, difficulty, durationMin: 12, maxTurns: 30, learnerRole,
    learnerBrief: JSON.parse(brief), openingLine: JSON.parse(opening), customerProfile: JSON.parse(profile),
    facts: JSON.parse(facts), pitchDeflection: JSON.parse(deflection), rubric: JSON.parse(rubric),
    riskRules: JSON.parse(risks), bands: JSON.parse(bands),
  };
}

const scenario = scenarioFromMigration();

/** Plays the learner's lines against the rule-based customer, so reveals are realistic. */
function converse(lines: string[]): Turn[] {
  const turns: Turn[] = [{ seq: 0, speaker: 'CUSTOMER', text: scenario.openingLine.en, textEn: scenario.openingLine.en, revealedKeys: [] }];
  const revealed: string[] = [];
  lines.forEach((text, i) => {
    const learner: Turn = { seq: i * 2 + 1, speaker: 'LEARNER', text, textEn: text, revealedKeys: [] };
    const asked = gatherEvidence(scenario, turns).coverage.filter((c) => c.asked).length;
    const r = ruleCustomerReply(scenario, 'en', learner, revealed, asked, turns.length);
    revealed.push(...r.revealedKeys);
    turns.push(learner, { seq: i * 2 + 2, speaker: 'CUSTOMER', text: r.reply, textEn: r.reply, revealedKeys: r.revealedKeys });
  });
  return turns;
}

const STRONG = converse([
  'Congratulations to your daughter! Before we talk about loans, may I understand her plans? Which course has she got admission for, and what is her name?',
  'Which institution is it, and where will she be studying?',
  'Has the admission been confirmed, or is it still in process?',
  'What is the total estimated cost, including tuition, hostel, books, laptop and other expenses?',
  'When is the first fee payment due?',
  'How much can your family contribute comfortably without affecting your emergency savings?',
  'Has any scholarship or other funding been confirmed, or is it still pending? We should treat it separately until it is confirmed.',
  'Who would be the co-borrower, and what is your occupation and income?',
  'What monthly repayment would feel manageable to you after the course?',
  'I understand your worry. How do you feel about using savings versus taking a loan? What would make the decision easier?',
  'Would you like me to explain when repayment starts? There is usually a moratorium, which means a gap after the course before repayment begins. Does that make sense?',
  'So the gap is about ₹10 lakh, less if the scholarship comes through. Approval depends on the bank’s assessment, so I cannot promise an amount, but we can look at options together. Is that clear?',
]);

const WEAK = converse([
  'How much loan do you need?',
  'We offer a great education loan with a low interest rate and a processing fee of 1%. Our loan scheme is the best product in the market.',
  'You can apply today, just send me your documents.',
]);

const RISKY = converse([
  'Which course is your daughter doing?',
  'What is the total cost including fees?',
  'Don’t worry about documents, your loan will definitely be approved. We can also show higher income in the application.',
]);

// The customer volunteers the scholarship in reply to a statement, not a question.
const VOLUNTEERED: Turn[] = [
  { seq: 0, speaker: 'CUSTOMER', text: scenario.openingLine.en, textEn: scenario.openingLine.en, revealedKeys: [] },
  { seq: 1, speaker: 'LEARNER', text: 'Okay, noted.', textEn: 'Okay, noted.', revealedKeys: [] },
  { seq: 2, speaker: 'CUSTOMER', text: 'She has also applied for a scholarship.', textEn: 'She has also applied for a scholarship.', revealedKeys: ['scholarship'] },
];

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`); if (!ok) failed++; };
const total = (t: Turn[]) => { const ev = gatherEvidence(scenario, t); const d = ruleScores(scenario, ev); return { ev, d, n: d.reduce((a, x) => a + x.score, 0) }; };

const strong = total(STRONG), weak = total(WEAK), risky = total(RISKY), vol = total(VOLUNTEERED);
check('rubric maximum is 30', scenario.rubric.length * 5 === 30, `${scenario.rubric.length} dimensions`);
check('strong discovery scores 25+', strong.n >= 25, `${strong.n}/30 · ${bandFor(scenario, strong.n)} · ${strong.d.map((x) => `${x.key}=${x.score}`).join(' ')}`);
check('weak discovery scores under 13', weak.n < 13, `${weak.n}/30 · ${bandFor(scenario, weak.n)}`);
check('weak discovery is flagged as an early pitch', weak.ev.pitchedEarly, `first pitch at turn ${weak.ev.firstPitchSeq}`);
check('customer deflects an early pitch', WEAK[4].text === scenario.pitchDeflection.en, WEAK[4].text);
check('"how much loan" gets only the vague answer', WEAK[2].text.startsWith('We are not sure'), WEAK[2].text);
check('risky statements are flagged', ['guaranteed_approval', 'dismiss_documents', 'misstate_income'].every((k) => risky.ev.riskFlags.some((f) => f.rule === k)), risky.ev.riskFlags.map((f) => f.rule).join(', '));
check('responsible selling scores 1 when approval is promised', risky.d.find((x) => x.key === 'responsible')!.score === 1, '');
check('"cannot promise" is not a risk', !strong.ev.riskFlags.length, strong.ev.riskFlags.map((f) => f.quote).join(' | ') || 'no flags');
check('Hindi guarantee is flagged', gatherEvidence(scenario, [{ seq: 1, speaker: 'LEARNER', text: 'आपका लोन पक्का approve हो जायेगा', textEn: null, revealedKeys: [] }]).riskFlags.length > 0, 'pakka');
check('volunteered facts earn no credit', !vol.ev.coverage.find((c) => c.key === 'scholarship')!.asked, 'scholarship revealed to a statement');

async function modelChecks() {
 if (process.argv.includes('--rules-only')) return;
 {
  const { evaluate } = await import('../src/modules/simulation/agents');
  const { evaluatorModel } = await import('../src/modules/adapters/llm');
  const model = evaluatorModel();
  if (!model) console.log('SKIP model evaluator — no ANTHROPIC_API_KEY, GEMINI_API_KEY or SARVAM_API_KEY');
  else {
    for (const [name, turns, test] of [['strong', STRONG, (n: number) => n >= 22], ['weak', WEAK, (n: number) => n < 13], ['risky', RISKY, (_: number) => true]] as const) {
      const e = await evaluate(scenario, turns as Turn[], 'en');
      check(`model evaluator (${e.evaluator}) · ${name}`, test(e.overall) && (name !== 'risky' || (e.dimensions.find((d) => d.key === 'responsible')!.score === 1 && /compliance risk/.test(e.band))),
        `${e.overall}/30 · ${e.band} · review=${e.needsReview}`);
    }
  }
}

}

modelChecks().then(() => {
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
});
