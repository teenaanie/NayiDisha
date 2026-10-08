import type { CompletionRequest } from './index';
import { mockJudge } from '../evaluation/mock-judge';
import { mockCoach } from '../coaching/mock-coach';

/**
 * The mock model. Deterministic, offline and clearly not a language model:
 * the roleplay mock states the authorised facts plainly, the evaluator mock
 * applies the rubric mechanically to rule evidence and configured cues, and the
 * coach mock turns verified findings into template sentences.
 *
 * It exists so the whole workflow can be exercised and tested without
 * credentials. Its output quality says nothing about a live model's.
 */
export async function mockComplete(req: CompletionRequest): Promise<string> {
  switch (req.task) {
    case 'roleplay': {
      const allowed = (req.data.allowed_facts_json ?? []) as { id: string; value: string; new_this_turn: boolean }[];
      // State exactly the facts this reply answers; fixture parts already said theirs.
      const answer = req.data.answer_fact_ids as string[] | undefined;
      const now = allowed.filter((f) => (answer ? answer.includes(f.id) : f.new_this_turn));
      if (!now.length) {
        // A leftover question beside a fixed answer gets the neutral unknown line.
        const text = req.data.also_reply_to_json ? req.data.unknown_response_json : (req.data.acknowledgement_json ?? req.data.unknown_response_json);
        return JSON.stringify({ text: String(text), used_fact_ids: [], requested_end: false });
      }
      const sentence = (v: string) => (/[.!?]$/.test(v) ? v : v + '.');
      return JSON.stringify({ text: now.map((f) => sentence(f.value)).join(' '), used_fact_ids: now.map((f) => f.id), requested_end: false });
    }
    case 'evaluate':
      return JSON.stringify(mockJudge(req.data as never));
    case 'coach':
      return JSON.stringify(mockCoach(req.data as never));
    case 'train': {
      // Merge: concatenate the batches. Review: flag customer replies that fell back or had a
      // draft rejected, quoting them exactly; tester notes are recorded as not checkable.
      const notes = (req.data.tester_notes_json ?? []) as { index: number }[];
      const findings = notes.map((n) => ({ note_index: n.index, verdict: 'not_checkable', explanation: 'The offline reviewer does not check notes.' }));
      if (req.data.batches_json) {
        const batches = req.data.batches_json as { summary: string; suggestions: unknown[] }[];
        return JSON.stringify({ summary: batches.map((b) => b.summary).join(' '), assessment_summary: 'Offline review: the assessment was not examined.', suggestions: batches.flatMap((b) => b.suggestions), tester_note_findings: findings });
      }
      const sessions = (req.data.sessions_json ?? []) as { ref: string; transcript: { turn: number; speaker: string; text: string; note?: string }[] }[];
      const suggestions = sessions.flatMap((s) => s.transcript.filter((t) => t.speaker === 'customer' && /reply=fallback|rejected=/.test(t.note ?? '')).map((t) => ({
        area: 'customer_replies', severity: 'medium', title: `Customer reply needed a fallback in ${s.ref}`, observation: `The AI customer's draft was rejected: ${t.note}.`,
        evidence: [{ session_ref: s.ref, from: 'transcript', turn: t.turn, quote: Array.from(t.text).slice(0, 24).join('') }], proposed_change: 'Review the rejected draft reason and adjust the customer instructions or facts.', occurrences: 1, tester_note_indexes: [],
      })));
      return JSON.stringify({ summary: `Offline review of ${sessions.length} session${sessions.length === 1 ? '' : 's'}.`, assessment_summary: 'Offline review: the assessment was not examined.', suggestions, tester_note_findings: findings });
    }
    case 'simulate': {
      // A scripted candidate: the questions its level would ask, in order; the excellent one ends
      // with a summary. Enough to drive the whole pipeline offline.
      const level = (req.data.level_json as { id: string }).id;
      const asked = ((req.data.history_json ?? []) as { speaker: string }[]).filter((t) => t.speaker === 'learner').length;
      const budget = Number(req.data.message_budget_json ?? 6);
      const scripts: Record<string, string[]> = {
        needs_improvement: ['Loan for what?', 'We have a good education loan, you should apply. How much and when?', 'Send your documents.'],
        competent: ['What do you need the loan for?', 'How much loan do you need?', 'What is your monthly income?', 'Do you have any other EMIs?', "What's a comfortable EMI for you?", 'So you need about 4 lakh for your daughter\'s fees. Is that right?'],
        excellent: ['How can I help you today? What is the loan for?', 'How much do you need?', 'When exactly do you need the money?', 'What is your monthly income?', 'You mentioned another EMI. How much do you pay for it each month?', "What's a comfortable EMI for you?", 'Do you have any concerns about taking a loan?', 'To summarise, you need about 4 lakh within 30 days for your daughter\'s fees, with a comfortable EMI and no hidden charges. Is that correct?'],
      };
      const list = scripts[level] ?? scripts.competent;
      const done = asked >= Math.min(list.length, budget) - 1;
      return JSON.stringify({ message: list[Math.min(asked, list.length - 1)], done });
    }
    case 'classify':
      return JSON.stringify({ intents: [], is_question: false, other_question: '' });
  }
}
