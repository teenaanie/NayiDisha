-- AI roleplay coaching platform (docs/roleplay, spec §16–17).
--
-- A schema of its own: the platform is tenant-scoped where the rest of the app
-- is not, and it must survive `001_schema.sql` dropping `app`. The DROP below
-- only matters on a reset; a normal migrate runs this file once.
--
-- Integrity rules carried by the database, not just the code:
--   * published configuration and committed turns are immutable (triggers);
--   * (session_id, sequence) and (session_id, client_message_id) are unique;
--   * every child row repeats tenant_id and references its parent through
--     (tenant_id, id), so a row can never point across tenants;
--   * evaluation runs are deduplicated on snapshot + bundle + evaluator + mode.

DROP SCHEMA IF EXISTS rp CASCADE;
CREATE SCHEMA rp;

CREATE TABLE rp.tenant (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  retention_days INT NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 1 AND 3650),
  -- author_reviewer_combined, daily_provider_call_budget, turns_per_minute, sessions_per_hour
  settings       JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rp.app_user (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES rp.tenant(id),
  subject      TEXT NOT NULL,              -- identity from the authentication layer
  display_name TEXT NOT NULL,
  synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject),
  UNIQUE (tenant_id, id)
);

CREATE TABLE rp.membership (
  tenant_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('learner','manager','author','reviewer','tenant_admin','worker')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to   TIMESTAMPTZ,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (tenant_id, user_id) REFERENCES rp.app_user(tenant_id, id)
);

CREATE TABLE rp.team (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES rp.tenant(id),
  name      TEXT NOT NULL,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE rp.team_membership (
  tenant_id  UUID NOT NULL,
  team_id    UUID NOT NULL,
  user_id    UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('member','manager')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to   TIMESTAMPTZ,
  PRIMARY KEY (team_id, user_id, role),
  FOREIGN KEY (tenant_id, team_id) REFERENCES rp.team(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES rp.app_user(tenant_id, id)
);

-- Prompt templates are platform assets, approved by template authors only (spec §4).
CREATE TABLE rp.prompt_version (
  id          TEXT PRIMARY KEY,           -- e.g. roleplay_v1; a change is a new id
  kind        TEXT NOT NULL CHECK (kind IN ('roleplay','evaluator','coach','classifier')),
  content     TEXT NOT NULL,
  digest      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('approved','retired')),
  approved_by TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rp.scenario_draft (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES rp.tenant(id),
  scenario_id  TEXT NOT NULL,
  revision     INT NOT NULL DEFAULT 1,
  status       TEXT NOT NULL CHECK (status IN ('draft','in_review','published','discarded')),
  bundle       JSONB NOT NULL,
  import_digest TEXT,
  base_version TEXT,                       -- the published version this draft edits, if any
  created_by   UUID NOT NULL,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  review_note  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX uq_open_draft ON rp.scenario_draft(tenant_id, scenario_id) WHERE status IN ('draft','in_review');

CREATE TABLE rp.scenario_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES rp.tenant(id),
  scenario_id     TEXT NOT NULL,
  version         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('published','retired')),
  bundle          JSONB NOT NULL,
  bundle_hash     TEXT NOT NULL,
  rubric_version  TEXT NOT NULL,           -- "<rubric id>@<version>"
  scoring_version TEXT NOT NULL,
  persona_version TEXT NOT NULL,
  risk_version    TEXT NOT NULL,
  prompt_versions JSONB NOT NULL,          -- {roleplay:{id,digest},...}
  engine_version  TEXT NOT NULL,
  preview_only    BOOLEAN NOT NULL DEFAULT FALSE,
  draft_id        UUID,
  published_by    UUID NOT NULL,
  reviewed_by     UUID NOT NULL,
  review_note     TEXT,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ,
  retired_reason  TEXT,
  UNIQUE (tenant_id, scenario_id, version),
  UNIQUE (tenant_id, id)
);

-- Published content never changes; only retirement metadata may be written.
CREATE FUNCTION rp.forbid_published_edit() RETURNS trigger AS $$
BEGIN
  IF NEW.bundle IS DISTINCT FROM OLD.bundle OR NEW.bundle_hash IS DISTINCT FROM OLD.bundle_hash
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
     OR NEW.prompt_versions IS DISTINCT FROM OLD.prompt_versions THEN
    RAISE EXCEPTION 'Published scenario versions are immutable; create a new version.';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'A retired version cannot be republished.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_scenario_version_immutable BEFORE UPDATE ON rp.scenario_version
  FOR EACH ROW EXECUTE FUNCTION rp.forbid_published_edit();

CREATE TABLE rp.session (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  learner_id          UUID NOT NULL,
  scenario_version_id UUID NOT NULL,
  scenario_id         TEXT NOT NULL,
  scenario_version    TEXT NOT NULL,
  bundle_hash         TEXT NOT NULL,
  rubric_version      TEXT NOT NULL,
  scoring_version     TEXT NOT NULL,
  prompt_versions     JSONB NOT NULL,
  engine_version      TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN ('created','active','completed','abandoned','evaluating','review_required','coaching','reported','report_partial','evaluation_failed')),
  revision            INT NOT NULL DEFAULT 0,
  parent_session_id   UUID,
  retry_scope         JSONB,               -- null for a first attempt; {mode, checkpoint_sequence, target_check_ids, plan_id}
  is_preview          BOOLEAN NOT NULL DEFAULT FALSE,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  elapsed_ms          BIGINT NOT NULL DEFAULT 0,
  learner_turn_count  INT NOT NULL DEFAULT 0,
  transcript_hash     TEXT,
  current_run_id      UUID,
  abandon_reason      TEXT,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, learner_id) REFERENCES rp.app_user(tenant_id, id),
  FOREIGN KEY (tenant_id, scenario_version_id) REFERENCES rp.scenario_version(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_session_id) REFERENCES rp.session(tenant_id, id)
);
CREATE INDEX idx_rp_session_learner ON rp.session(tenant_id, learner_id, started_at DESC);

CREATE TABLE rp.turn (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL,
  sequence          INT NOT NULL CHECK (sequence >= 0),
  speaker           TEXT NOT NULL CHECK (speaker IN ('learner','customer')),
  text              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_message_id TEXT,
  generation_id     UUID,
  state             TEXT NOT NULL DEFAULT 'committed' CHECK (state = 'committed'),
  origin            TEXT NOT NULL CHECK (origin IN ('live','opening','retry_prefix')),
  UNIQUE (session_id, sequence),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES rp.session(tenant_id, id)
);
CREATE UNIQUE INDEX uq_rp_turn_client_msg ON rp.turn(session_id, client_message_id) WHERE client_message_id IS NOT NULL;

-- Committed speech is evidence; it is never edited. Retention purges delete whole sessions.
CREATE FUNCTION rp.forbid_turn_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Committed turns are immutable.'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_turn_immutable BEFORE UPDATE ON rp.turn FOR EACH ROW EXECUTE FUNCTION rp.forbid_turn_update();

-- What the runtime concluded about a learner turn, and how the reply was produced.
CREATE TABLE rp.turn_analysis (
  turn_id            UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  session_id         UUID NOT NULL,
  intents            JSONB NOT NULL,       -- [{intent_id, confidence, question, start, end}]
  low_confidence     BOOLEAN NOT NULL,
  classifier_version TEXT NOT NULL,
  plan               JSONB NOT NULL,
  generation         JSONB NOT NULL,       -- attempts, provider/model ids, latency, validator version
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES rp.turn(tenant_id, id)
);

CREATE TABLE rp.operation (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  session_id       UUID NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('customer_turn','evaluation')),
  status           TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  learner_turn_id  UUID,
  customer_turn_id UUID,
  run_id           UUID,
  error            JSONB,
  attempts         INT NOT NULL DEFAULT 0,
  lease_until      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES rp.session(tenant_id, id)
);
-- At most one customer response in flight per session (spec §5 step 4).
CREATE UNIQUE INDEX uq_rp_one_pending_turn ON rp.operation(session_id) WHERE kind = 'customer_turn' AND status = 'pending';

CREATE TABLE rp.disclosure_event (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  session_id         UUID NOT NULL,
  fact_id            TEXT NOT NULL,
  trigger_turn_id    UUID,                 -- null for facts public from the opening
  intent_id          TEXT,
  method             TEXT NOT NULL CHECK (method IN ('opening','fixture','generated','retry_prefix')),
  confidence         NUMERIC(4,3),
  customer_turn_id   UUID NOT NULL,
  classifier_version TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, fact_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES rp.session(tenant_id, id)
);

CREATE TABLE rp.transcript_snapshot (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  session_id    UUID NOT NULL UNIQUE,
  last_sequence INT NOT NULL,
  content       JSONB NOT NULL,            -- ordered turns exactly as committed
  hash          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES rp.session(tenant_id, id)
);

CREATE TABLE rp.evaluation_run (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL,
  snapshot_id       UUID NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('full','focused')),
  dedupe_key        TEXT NOT NULL,
  attempt           INT NOT NULL DEFAULT 1,
  status            TEXT NOT NULL CHECK (status IN ('queued','evaluating','review_required','coaching','reported','report_partial','evaluation_failed','superseded')),
  evaluator_version TEXT NOT NULL,
  prompt_versions   JSONB NOT NULL,
  provider          TEXT,
  model             TEXT,
  outputs           JSONB NOT NULL DEFAULT '[]',   -- every provider output with its validation result
  candidate         JSONB,                         -- the accepted candidate
  review_reasons    JSONB NOT NULL DEFAULT '[]',
  score             JSONB,                         -- ScoreResult (null for focused runs)
  focused_results   JSONB,
  error             JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES rp.session(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES rp.transcript_snapshot(tenant_id, id)
);
-- A re-evaluation is a new attempt; the same attempt never runs twice.
CREATE UNIQUE INDEX uq_rp_run_dedupe ON rp.evaluation_run(dedupe_key, attempt);

CREATE TABLE rp.evidence (
  run_id            UUID NOT NULL REFERENCES rp.evaluation_run(id) ON DELETE CASCADE,
  id                TEXT NOT NULL,
  tenant_id         UUID NOT NULL,
  check_id          TEXT,
  category          TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('observed','not_observed','contradicted','uncertain')),
  learner_spans     JSONB NOT NULL,
  context_spans     JSONB NOT NULL,
  searched_turn_ids JSONB NOT NULL,
  explanation       TEXT NOT NULL,
  method            TEXT NOT NULL,
  confidence        NUMERIC(4,3) NOT NULL,
  rule_version      TEXT,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE rp.dimension_score (
  run_id       UUID NOT NULL REFERENCES rp.evaluation_run(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL,
  tenant_id    UUID NOT NULL,
  score        INT NOT NULL,
  anchor_score INT NOT NULL,
  evidence_ids JSONB NOT NULL,
  rationale    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('scored','uncertain')),
  PRIMARY KEY (run_id, dimension_id)
);

CREATE TABLE rp.risk_finding (
  run_id            UUID NOT NULL REFERENCES rp.evaluation_run(id) ON DELETE CASCADE,
  rule_id           TEXT NOT NULL,
  tenant_id         UUID NOT NULL,
  evidence_ids      JSONB NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('confirmed','uncertain')),
  source            TEXT NOT NULL CHECK (source IN ('rule','model','both')),
  severity          TEXT NOT NULL,
  consequence       TEXT NOT NULL,
  reviewer_decision TEXT CHECK (reviewer_decision IN ('upheld','dismissed')),
  reviewer_id       UUID,
  reviewer_note     TEXT,
  decided_at        TIMESTAMPTZ,
  PRIMARY KEY (run_id, rule_id)
);

CREATE TABLE rp.coaching_report (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  run_id         UUID NOT NULL UNIQUE REFERENCES rp.evaluation_run(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('final','provisional','partial')),
  content        JSONB NOT NULL,
  generation     JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rp.retry_plan (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  run_id                  UUID NOT NULL REFERENCES rp.evaluation_run(id) ON DELETE CASCADE,
  session_id              UUID NOT NULL,
  mode                    TEXT NOT NULL CHECK (mode IN ('full','focused')),
  checkpoint_after_turn_id UUID,
  checkpoint_sequence     INT,
  target_check_ids        JSONB NOT NULL,
  instruction             TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, mode)
);

CREATE TABLE rp.job (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('customer_turn','evaluate','coach','project_analytics')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  lease_until     TIMESTAMPTZ,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rp_job_ready ON rp.job(status, run_after);

CREATE TABLE rp.idempotency (
  tenant_id       UUID NOT NULL,
  actor_id        UUID NOT NULL,
  route           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, route, key)
);

CREATE TABLE rp.audit_event (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID,
  actor_id     UUID,
  actor_roles  JSONB NOT NULL DEFAULT '[]',
  action       TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT,
  before_hash  TEXT,
  after_hash   TEXT,
  request_id   TEXT,
  detail       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rp_audit_subject ON rp.audit_event(subject_type, subject_id, created_at);

-- One row per assessment that analytics may count; the projection is idempotent on run_id.
CREATE TABLE rp.analytics_fact (
  run_id             UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  session_id         UUID NOT NULL,
  learner_id         UUID NOT NULL,
  scenario_id        TEXT NOT NULL,
  scenario_version   TEXT NOT NULL,
  rubric_version     TEXT NOT NULL,
  scoring_version    TEXT NOT NULL,
  mode               TEXT NOT NULL,
  parent_session_id  UUID,
  raw_total          INT,
  raw_max            INT,
  final_percent      NUMERIC(7,3),
  band_id            TEXT,
  dimension_scores   JSONB NOT NULL,
  check_results      JSONB NOT NULL,
  confirmed_risk     BOOLEAN NOT NULL,
  pending_review     BOOLEAN NOT NULL,
  status             TEXT NOT NULL,
  selection_policy   TEXT NOT NULL DEFAULT 'first_valid_full',
  completed_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE rp.metric_event (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID,
  name       TEXT NOT NULL,
  value      NUMERIC NOT NULL DEFAULT 1,
  tags       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rp_metric_name ON rp.metric_event(name, created_at);

CREATE TABLE rp.usage_counter (
  tenant_id UUID NOT NULL,
  actor_id  UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',  -- nil = tenant-wide
  bucket    TEXT NOT NULL,                 -- e.g. provider_calls:2026-09-28, turns:2026-09-28T14:05
  count     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, bucket, actor_id)
);
