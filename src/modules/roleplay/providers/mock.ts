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
        return JSON.stringify({ summary: batches.map((b) => b.summary).join(' '), suggestions: batches.flatMap((b) => b.suggestions), tester_note_findings: findings });
      }
      const sessions = (req.data.sessions_json ?? []) as { ref: string; transcript: { turn: number; speaker: string; text: string; note?: string }[] }[];
      const suggestions = sessions.flatMap((s) => s.transcript.filter((t) => t.speaker === 'customer' && /reply=fallback|rejected=/.test(t.note ?? '')).map((t) => ({
        area: 'customer_replies', severity: 'medium', title: `Customer reply needed a fallback in ${s.ref}`, observation: `The AI customer's draft was rejected: ${t.note}.`,
        evidence: [{ session_ref: s.ref, turn: t.turn, quote: Array.from(t.text).slice(0, 24).join('') }], proposed_change: 'Review the rejected draft reason and adjust the customer instructions or facts.', occurrences: 1, tester_note_indexes: [],
      })));
      return JSON.stringify({ summary: `Offline review of ${sessions.length} session${sessions.length === 1 ? '' : 's'}.`, suggestions, tester_note_findings: findings });
    }
    case 'classify':
      return JSON.stringify({ intents: [], is_question: false, other_question: '' });
  }
}
