-- Role-specific onboarding scripts.
--
-- The existing assessment_template is a fixed multiple-choice bank: every role
-- gets the same shape of question and grading is exact string equality. That
-- cannot ask a Delivery Rider about a licence or score an open answer about
-- what they would do at an unmarked address.
--
-- A role_script is the conversational counterpart, versioned the same way an
-- assessment_template is. Two kinds of turn:
--   ATTRIBUTE — interpreted into app.candidate_attribute_value, exactly as the
--               typed profile form does today.
--   SKILL     — an open spoken answer, scored against a written rubric.
--
-- Every scored answer keeps the verbatim transcript, the rubric version, the
-- scorer that produced it and its reasoning, so a score can be re-read and
-- argued with later. A score whose provenance cannot be shown is not a score.

CREATE TABLE app.role_script (
  id             TEXT PRIMARY KEY,
  role_config_id TEXT NOT NULL REFERENCES app.role_configuration(id),
  version        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  languages      JSONB NOT NULL DEFAULT '["en","hi","mr"]',
  -- Ordered turns. ATTRIBUTE turns always run; SKILL turns form a bank from
  -- which ask_count are drawn per run, mirroring assessment question shuffling.
  turns          JSONB NOT NULL DEFAULT '[]',
  ask_count      INT NOT NULL DEFAULT 3 CHECK (ask_count > 0),
  pass_threshold INT NOT NULL CHECK (pass_threshold BETWEEN 0 AND 100),
  created_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (role_config_id, version)
);

-- Which script a role configuration runs. Nullable: a config with no script
-- keeps using its assessment_template, so every existing role is unaffected.
-- Deliberately not a foreign key, matching assessment_template_id. A real
-- constraint here would be circular (role_script points back at the
-- configuration), which makes any ordered snapshot restore impossible.
ALTER TABLE app.role_configuration ADD COLUMN role_script_id TEXT;

CREATE TABLE app.script_run (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES app.candidate(id),
  script_id      TEXT NOT NULL REFERENCES app.role_script(id),
  script_version TEXT NOT NULL,
  job_id         TEXT REFERENCES app.job(id),
  -- The SKILL turns actually drawn for this run, so the score is reproducible.
  turn_keys      JSONB NOT NULL DEFAULT '[]',
  score          INT,
  max_score      INT,
  status         TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','ABANDONED')),
  started_at     TIMESTAMPTZ NOT NULL,
  completed_at   TIMESTAMPTZ
);
CREATE INDEX idx_script_run_candidate ON app.script_run(candidate_id, script_id, completed_at DESC);

CREATE TABLE app.script_response (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES app.script_run(id),
  candidate_id   TEXT NOT NULL REFERENCES app.candidate(id),
  turn_key       TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('ATTRIBUTE','SKILL')),
  language       TEXT NOT NULL CHECK (language IN ('en','hi','mr')),
  -- What the candidate actually said. Never overwritten; a correction is a new row.
  transcript     TEXT NOT NULL,
  interpreted    JSONB,
  score          INT,
  max_score      INT,
  rubric_version TEXT,
  scorer         TEXT,
  reasoning      TEXT,
  credits        JSONB NOT NULL DEFAULT '[]',
  confidence     NUMERIC(3,2) NOT NULL DEFAULT 0,
  -- Set when the score should not be trusted unreviewed: low model confidence,
  -- or the keyword fallback ran because no model was reachable.
  needs_review   BOOLEAN NOT NULL DEFAULT FALSE,
  accepted       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_script_response_run ON app.script_response(run_id, created_at);
CREATE INDEX idx_script_response_candidate ON app.script_response(candidate_id, created_at DESC);
