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
    case 'classify':
      return JSON.stringify({ intents: [], is_question: false, other_question: '' });
  }
}
