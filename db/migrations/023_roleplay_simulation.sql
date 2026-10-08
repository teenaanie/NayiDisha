-- Simulated candidates for the Practice coach (operator menu → Simulated candidates).
--
-- AI candidates at three levels (needs improvement, competent, excellent) practise with the AI
-- customer through the real product: their sessions are ordinary rp.session rows of synthetic
-- learners in their own team, assessed and coached as usual, then a graded assessment. A run
-- checks that scores land in each level's expected band and hands the sessions to the AI
-- training agent. Work advances in short steps under a lease, like rp.training_run.

CREATE TABLE IF NOT EXISTS rp.sim_run (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES rp.tenant(id),
  status           TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
  config           JSONB NOT NULL,          -- {levels, practice_sessions, assessment, learn, language, message_budget, train_after}
  scenario_id      TEXT NOT NULL,
  summary          JSONB,                   -- calibration per level, written on completion
  training_run_id  UUID,
  error            TEXT,
  lease_until      TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_rp_sim_run_tenant ON rp.sim_run(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rp.sim_session (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  run_id        UUID NOT NULL,
  level         TEXT NOT NULL,
  seq           INT NOT NULL,               -- 1..n per level; the graded assessment comes last
  kind          TEXT NOT NULL CHECK (kind IN ('practice','assessment')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','talking','scoring','done','failed')),
  session_id    UUID,
  messages      INT NOT NULL DEFAULT 0,
  closing       BOOLEAN NOT NULL DEFAULT FALSE,  -- the candidate has closed; the next step finishes
  final_percent NUMERIC,
  band_label    TEXT,
  coach_notes   JSONB,                      -- what the candidate was given from its previous report
  error         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, level, seq),
  FOREIGN KEY (tenant_id, run_id) REFERENCES rp.sim_run(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rp_sim_session_session ON rp.sim_session(session_id);

-- A simulation's training run reviews exactly its own sessions ('sessions'); only 'period' runs
-- move the watermark, so real sessions assessed meanwhile still reach the next weekly run.
ALTER TABLE rp.training_run ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'period' CHECK (scope IN ('period','sessions'));
