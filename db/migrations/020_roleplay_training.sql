-- AI training agent for the Practice coach.
--
-- A training run reviews the practice sessions whose assessment finished in
-- (period_from, period_to]: what the AI customer said, how questions were
-- understood, and how the assessment and coaching came out, together with
-- notes from human testers. It suggests improvements; a person accepts, edits
-- or rejects each one, and the accepted ones become a build brief for the next
-- scenario or prompt version. Nothing here changes live content by itself.
--
-- Runs are the log of what has been assessed: the next run starts where the
-- last one ended. The work is split into steps (a few sessions per model call)
-- so each fits within one serverless invocation; `lease_until` stops two
-- invocations from working on the same run.

CREATE TABLE IF NOT EXISTS rp.training_run (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES rp.tenant(id),
  trigger        TEXT NOT NULL CHECK (trigger IN ('manual','weekly')),
  period_from    TIMESTAMPTZ NOT NULL,
  period_to      TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('analysing','in_review','approved','failed')),
  session_ids    UUID[] NOT NULL DEFAULT '{}',
  sessions_skipped INT NOT NULL DEFAULT 0,       -- beyond the per-run cap; picked up by the next run
  steps          JSONB NOT NULL DEFAULT '[]',     -- [{refs, status, attempts, output, error}]
  result         JSONB,                           -- {summary, tester_note_findings, dropped}
  tester_notes   TEXT,
  model          TEXT,
  prompt_ids     JSONB NOT NULL DEFAULT '{}',     -- {review: {id, digest}, merge: {id, digest}}
  error          TEXT,
  lease_until    TIMESTAMPTZ,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  reviewed_by    TEXT,
  approved_at    TIMESTAMPTZ,
  brief_md       TEXT,
  UNIQUE (tenant_id, id),
  CHECK (period_to >= period_from)
);
CREATE INDEX IF NOT EXISTS idx_rp_training_run_tenant ON rp.training_run(tenant_id, period_to DESC);

CREATE TABLE IF NOT EXISTS rp.training_suggestion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  run_id          UUID NOT NULL,
  seq             INT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('agent','tester_note')),
  area            TEXT NOT NULL CHECK (area IN ('customer_replies','question_understanding','scenario_content','assessment','coaching','other')),
  severity        TEXT NOT NULL CHECK (severity IN ('high','medium','low')),
  title           TEXT NOT NULL,
  observation     TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '[]',    -- [{session_id, ref, turn, speaker, quote}]
  proposed_change TEXT NOT NULL,
  occurrences     INT NOT NULL DEFAULT 1,
  tester_note_indexes INT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  edited_change   TEXT,                           -- the reviewer's version of proposed_change
  reviewer_note   TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE (run_id, seq),
  FOREIGN KEY (tenant_id, run_id) REFERENCES rp.training_run(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rp_training_suggestion_run ON rp.training_suggestion(run_id);
