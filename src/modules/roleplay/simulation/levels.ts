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
}

export const SIM_LEVELS = candidates.levels as SimLevel[];
export const simLevel = (id: string) => SIM_LEVELS.find((l) => l.id === id) ?? null;
export const simSubject = (id: string) => `sim:candidate.${id}`;
export const SIM_RUNNER_SUBJECT = 'sim:runner';
export const SIM_TEAM = 'Simulated candidates';
