import candidates from '../../../../content/simulation/candidates.json';

/**
 * Simulated candidate levels (content/simulation/candidates.json). Imported statically so the
 * file ships with every serverless function that runs a simulation.
 */
export interface SimLevel {
  id: 'needs_improvement' | 'competent' | 'excellent';
  label: string;
  expected_band: { label: string; min: number; max: number };
  behaviour: string[];
  use_feedback: string;
  /** Named areas the level covers; the candidate tracks them by these names. */
  areas?: string[];
  /** Added to the run's message limit for this level. */
  extra_messages?: number;
}

export interface SimPersonality { id: string; label: string; style: string }

export const SIM_LEVELS = candidates.levels as SimLevel[];
export const SIM_PERSONALITIES = candidates.personalities as SimPersonality[];
export const simPersonality = (id: string | null) => SIM_PERSONALITIES.find((p) => p.id === id) ?? null;
/** A personality for the next session, never the same as the last one (random otherwise). */
export function pickPersonality(previous: string | null, rand = Math.random): SimPersonality {
  const pool = SIM_PERSONALITIES.filter((p) => p.id !== previous);
  return pool[Math.floor(rand() * pool.length)] ?? SIM_PERSONALITIES[0];
}
export const simLevel = (id: string) => SIM_LEVELS.find((l) => l.id === id) ?? null;
export const simSubject = (id: string) => `sim:candidate.${id}`;
export const SIM_RUNNER_SUBJECT = 'sim:runner';
/** This level's message limit in a run. */
export const levelBudget = (level: SimLevel, runBudget: number) => runBudget + (level.extra_messages ?? 0);
export const SIM_TEAM = 'Simulated candidates';
