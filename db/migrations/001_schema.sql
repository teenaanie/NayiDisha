-- Multi-Industry Frontline Hiring Platform — core schema
-- Implements the §12 core data model of PRD v1.3.
-- Conventions:
--   * All monetary values are BIGINT paise. Never rupees, never float. (§24.2)
--   * All state-bearing rows carry created_at; anything with a window carries its own timestamps.
--   * Ledger tables are append-only: corrections are new linked rows, never UPDATEs. (REF-08)

DROP SCHEMA IF EXISTS app CASCADE;
CREATE SCHEMA app;
SET search_path TO app, public;

-- ---------------------------------------------------------------------------
-- Demo control (§21.2) — deterministic clock so holds and expiries are provable
-- ---------------------------------------------------------------------------
CREATE TABLE demo_clock (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  now_at          TIMESTAMPTZ NOT NULL,
  reset_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  demo_mode       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- Configuration layer (§8.4A CFG-01..10)
-- Industry content lives here as data. No BFSI concept becomes a column. (§2.1)
-- ---------------------------------------------------------------------------
CREATE TABLE industry (
  key             TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  translations    JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE role_family (
  key             TEXT PRIMARY KEY,
  industry_key    TEXT NOT NULL REFERENCES industry(key),
  display_name    TEXT NOT NULL,
  parent_key      TEXT REFERENCES role_family(key),
  transferable    JSONB NOT NULL DEFAULT '[]',   -- CFG-08 transferable skill mapping
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL
);

-- CFG-02 — attribute definitions are the schema for candidate/job data
CREATE TABLE attribute_definition (
  key             TEXT PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('CANDIDATE_COMMON','CANDIDATE_ROLE','JOB')),
  data_type       TEXT NOT NULL CHECK (data_type IN ('TEXT','INT','MONEY_PAISE','BOOL','ENUM','MULTI_ENUM','DATE')),
  display_name    TEXT NOT NULL,
  allowed_values  JSONB NOT NULL DEFAULT '[]',
  validation      JSONB NOT NULL DEFAULT '{}',
  sensitivity     TEXT NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL','SENSITIVE')),
  freshness_days  INT,                            -- CAN-11 staleness
  translations    JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL
);

-- CFG-03/04/05 — immutable published versions
CREATE TABLE role_configuration (
  id                    TEXT PRIMARY KEY,
  industry_key          TEXT NOT NULL REFERENCES industry(key),
  role_family_key       TEXT NOT NULL REFERENCES role_family(key),
  version               TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','RETIRED','SANDBOX')),
  candidate_attributes  JSONB NOT NULL DEFAULT '[]',  -- attribute_definition keys + required flag
  job_attributes        JSONB NOT NULL DEFAULT '[]',
  critical_skills       JSONB NOT NULL DEFAULT '[]',
  qualification_rules   JSONB NOT NULL DEFAULT '{}',  -- Stage A/B rules
  scoring_weights       JSONB NOT NULL DEFAULT '{}',  -- Stage C weights, must total 100
  endorsement_cap       INT  NOT NULL DEFAULT 5,      -- scaled contribution ceiling (END-07)
  assessment_template_id TEXT,
  assessment_threshold  INT,
  preview_fields        JSONB NOT NULL DEFAULT '[]',  -- LEAD-01 masked preview
  unlock_fields         JSONB NOT NULL DEFAULT '[]',  -- LEAD-05 revealed on unlock
  document_checklist    JSONB NOT NULL DEFAULT '[]',
  effective_from        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL,
  UNIQUE (role_family_key, version)
);

CREATE TABLE assessment_template (
  id              TEXT PRIMARY KEY,
  industry_key    TEXT NOT NULL REFERENCES industry(key),
  role_family_key TEXT NOT NULL REFERENCES role_family(key),
  version         TEXT NOT NULL,
  sections        JSONB NOT NULL DEFAULT '[]',
  questions       JSONB NOT NULL DEFAULT '[]',   -- TEST-01 versioned bank
  pass_threshold  INT NOT NULL,
  time_limit_sec  INT,
  languages       JSONB NOT NULL DEFAULT '["en"]',
  status          TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE document_definition (
  key             TEXT PRIMARY KEY,
  industry_key    TEXT,
  purpose         TEXT NOT NULL,
  required_stage  TEXT NOT NULL,
  access_policy   TEXT NOT NULL,
  retention_days  INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

-- CFG-06/07/10 — release packaging, feature flags, approvals
CREATE TABLE configuration_release (
  id              TEXT PRIMARY KEY,
  package_name    TEXT NOT NULL,
  version         TEXT NOT NULL,
  role_config_ids JSONB NOT NULL DEFAULT '[]',
  geography       TEXT,
  cohort_flag     TEXT,
  approved_by     TEXT,
  effective_from  TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','RETIRED')),
  validation      JSONB NOT NULL DEFAULT '{}',   -- CFG-07 gate results
  created_at      TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Geography — seeded Pune locality centroids behind the TravelTimeProvider (MATCH-02)
-- ---------------------------------------------------------------------------
CREATE TABLE locality (
  key             TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  city            TEXT NOT NULL DEFAULT 'Pune',
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL
);

-- ---------------------------------------------------------------------------
-- Employer (§8.1, §8.5)
-- ---------------------------------------------------------------------------
CREATE TABLE employer_organisation (
  id              TEXT PRIMARY KEY,
  legal_name      TEXT NOT NULL,
  brand_name      TEXT NOT NULL,
  gst_pan         TEXT,
  billing_contact TEXT,
  status          TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_REVIEW','VERIFIED','SUSPENDED','REJECTED')),
  status_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  status_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE employer_location (
  id              TEXT PRIMARY KEY,
  employer_id     TEXT NOT NULL REFERENCES employer_organisation(id),
  name            TEXT NOT NULL,
  locality_key    TEXT NOT NULL REFERENCES locality(key),
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  hours           TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE employer_user (
  id              TEXT PRIMARY KEY,
  employer_id     TEXT NOT NULL REFERENCES employer_organisation(id),
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('COMPANY_ADMIN','BRANCH_RECRUITER')),
  location_scope  JSONB NOT NULL DEFAULT '[]',   -- empty = all locations
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE job (
  id                  TEXT PRIMARY KEY,
  employer_id         TEXT NOT NULL REFERENCES employer_organisation(id),
  location_id         TEXT NOT NULL REFERENCES employer_location(id),
  role_config_id      TEXT NOT NULL REFERENCES role_configuration(id),
  title               TEXT NOT NULL,
  openings            INT NOT NULL,
  fixed_pay_paise     BIGINT NOT NULL,
  variable_max_paise  BIGINT NOT NULL DEFAULT 0,
  shift               TEXT NOT NULL,
  weekly_off          TEXT,
  languages           JSONB NOT NULL DEFAULT '[]',
  min_experience_mo   INT NOT NULL DEFAULT 0,
  critical_skills     JSONB NOT NULL DEFAULT '[]',
  attributes          JSONB NOT NULL DEFAULT '{}',  -- config-driven job fields (JOB-08)
  status              TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','LIVE','PAUSED','FILLED','CLOSED','EXPIRED','SUSPENDED')),
  published_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,                  -- JOB-03 30 days
  created_at          TIMESTAMPTZ NOT NULL
);

-- §12 PostingEntitlement — the balance the employer dashboard shows (JOB-07)
CREATE TABLE posting_entitlement (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES job(id),
  location_id         TEXT NOT NULL REFERENCES employer_location(id),
  posting_fee_paise   BIGINT NOT NULL,
  credits_included    INT NOT NULL,
  credits_purchased   INT NOT NULL DEFAULT 0,
  max_distinct_unlocks INT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  credit_expiry_at    TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Partner (§8.2)
-- ---------------------------------------------------------------------------
CREATE TABLE partner (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  partner_type      TEXT NOT NULL,                -- PART-02, configuration value not enum
  is_business       BOOLEAN NOT NULL DEFAULT TRUE,
  capabilities      JSONB NOT NULL DEFAULT '[]',  -- PART-03 industry/role families
  service_localities JSONB NOT NULL DEFAULT '[]',
  languages         JSONB NOT NULL DEFAULT '[]',
  pan               TEXT,                          -- PART-04 / s.194H
  payout_upi        TEXT,
  risk_tier         TEXT NOT NULL DEFAULT 'STANDARD',
  status            TEXT NOT NULL CHECK (status IN ('PENDING_REVIEW','VERIFIED','SUSPENDED','REJECTED')),
  status_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  status_at         TIMESTAMPTZ NOT NULL
);

CREATE TABLE partner_site (
  id              TEXT PRIMARY KEY,
  partner_id      TEXT NOT NULL REFERENCES partner(id),
  locality_key    TEXT NOT NULL REFERENCES locality(key),
  partner_code    TEXT NOT NULL UNIQUE,          -- PART-05 human-readable
  qr_token        TEXT NOT NULL UNIQUE,          -- signed, revocable
  status          TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  created_at      TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Candidate (§8.3)
-- ---------------------------------------------------------------------------
CREATE TABLE candidate (
  id                  TEXT PRIMARY KEY,
  phone               TEXT NOT NULL UNIQUE,
  name                TEXT,
  language            TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('mr','hi','en')),
  locality_key        TEXT REFERENCES locality(key),
  age_confirmed_18    BOOLEAN NOT NULL DEFAULT FALSE,   -- CAN-08
  experience_months   INT NOT NULL DEFAULT 0,
  experience_tags     JSONB NOT NULL DEFAULT '[]',
  languages           JSONB NOT NULL DEFAULT '[]',
  current_pay_paise   BIGINT,
  expected_pay_paise  BIGINT,
  max_commute_min     INT NOT NULL DEFAULT 60,
  shift_availability  JSONB NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL CHECK (status IN ('STARTED','MOBILE_VERIFIED','PROFILE_INCOMPLETE','PROFILE_ACTIVE','PAUSED','DELETED_BLOCKED')),
  mobile_verified_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL
);

-- CAN-10/11 — role-specific answers as typed values against a versioned definition
CREATE TABLE candidate_attribute_value (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidate(id),
  attribute_key     TEXT NOT NULL REFERENCES attribute_definition(key),
  role_config_id    TEXT REFERENCES role_configuration(id),
  value_text        TEXT,
  value_int         BIGINT,
  value_bool        BOOLEAN,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  collected_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (candidate_id, attribute_key)
);

-- §12 ConsentRecord — one row per purpose, independently withdrawable
CREATE TABLE consent_record (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('PROCESSING','PARTNER_ASSISTANCE','JOB_ALERTS','DOCUMENTS','PRECISE_LOCATION')),
  notice_version  TEXT NOT NULL,
  channel         TEXT NOT NULL,
  granted_at      TIMESTAMPTZ,
  withdrawn_at    TIMESTAMPTZ,
  UNIQUE (candidate_id, purpose)
);

CREATE TABLE assessment_attempt (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  template_id     TEXT NOT NULL REFERENCES assessment_template(id),
  template_version TEXT NOT NULL,
  responses       JSONB NOT NULL DEFAULT '[]',   -- TEST-01 question-level
  score           INT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE achievement (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  category        TEXT NOT NULL,                 -- ACH-01 structured categories
  description     TEXT NOT NULL,
  evidence_ref    TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,  -- ACH-02 "candidate provided" until verified
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE endorsement (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidate(id),
  endorser_name     TEXT NOT NULL,
  endorser_contact  TEXT NOT NULL,               -- END-08 never exposed to employer
  relationship      TEXT NOT NULL CHECK (relationship IN ('FORMER_MANAGER','SENIOR_COLLEAGUE','EXPERIENCED_COLLEAGUE','PEER','SELF_OR_DUPLICATE')),
  period_known      TEXT,
  competencies      JSONB NOT NULL DEFAULT '[]',
  comment           TEXT,
  status            TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED_CONTACT','WITHDRAWN','EXPIRED','FLAGGED','HIDDEN')),
  raw_points        INT NOT NULL DEFAULT 0,      -- END-05 raw scale (manager 10 / colleague 5)
  invite_token      TEXT,
  invited_at        TIMESTAMPTZ,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Attribution (§8.11) — first valid OTP-verified registration wins, immutably
-- ---------------------------------------------------------------------------
CREATE TABLE attribution (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidate(id) UNIQUE,   -- REF-02 one per candidate
  partner_id        TEXT REFERENCES partner(id),
  partner_site_id   TEXT REFERENCES partner_site(id),
  method            TEXT NOT NULL CHECK (method IN ('QR','PARTNER_CODE','DIRECT','MANUAL_CORRECTION')),
  window_days       INT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE','UNDER_REVIEW','CORRECTED','VOID')),
  status_reason     TEXT,
  bound_at          TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE TABLE partner_nudge (
  id              TEXT PRIMARY KEY,
  partner_id      TEXT NOT NULL REFERENCES partner(id),
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  job_id          TEXT REFERENCES job(id),
  template_key    TEXT NOT NULL,                -- ALT-06 platform-controlled only
  delivered_at    TIMESTAMPTZ,
  response        TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Application and matching (§8.7)
-- ---------------------------------------------------------------------------
CREATE TABLE application (
  id                  TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL REFERENCES candidate(id),
  job_id              TEXT NOT NULL REFERENCES job(id),
  source              TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (
                        'INTERESTED','APPLIED','ELIGIBILITY_CHECK','CANDIDATE_RECONFIRMED',
                        'QUALIFIED','NOT_QUALIFIED','PREVIEWED','UNLOCKED','CONTACTED',
                        'INTERVIEW','REJECTED','SELECTED','JOINED','WITHDRAWN')),
  consent_snapshot    JSONB NOT NULL DEFAULT '{}',  -- what consent looked like at apply time
  reconfirmed_at      TIMESTAMPTZ,                  -- MATCH-09
  applied_at          TIMESTAMPTZ NOT NULL,
  status_at           TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL,
  UNIQUE (candidate_id, job_id)
);

CREATE TABLE match_result (
  id                  TEXT PRIMARY KEY,
  application_id      TEXT NOT NULL REFERENCES application(id),
  candidate_id        TEXT NOT NULL REFERENCES candidate(id),
  job_id              TEXT NOT NULL REFERENCES job(id),
  role_config_id      TEXT NOT NULL REFERENCES role_configuration(id),
  rule_version        TEXT NOT NULL,                -- MATCH-06 version stamped
  stage_a_pass        BOOLEAN NOT NULL,
  stage_b_pass        BOOLEAN NOT NULL,
  qualified           BOOLEAN NOT NULL,             -- MATCH-08
  score               INT,
  score_components    JSONB NOT NULL DEFAULT '{}',
  endorsement_points  INT NOT NULL DEFAULT 0,
  explanation         JSONB NOT NULL DEFAULT '[]',  -- MATCH-03/10
  gaps                JSONB NOT NULL DEFAULT '[]',
  inputs_snapshot     JSONB NOT NULL DEFAULT '{}',  -- §25 reproducibility
  computed_at         TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Commercial (§8.8, §9) — append-only ledgers, internal ledger is source of truth
-- ---------------------------------------------------------------------------
CREATE TABLE qualified_lead_unlock (
  id                    TEXT PRIMARY KEY,
  employer_id           TEXT NOT NULL REFERENCES employer_organisation(id),
  job_id                TEXT NOT NULL REFERENCES job(id),
  candidate_id          TEXT NOT NULL REFERENCES candidate(id),
  application_id        TEXT NOT NULL REFERENCES application(id),
  match_result_id       TEXT NOT NULL REFERENCES match_result(id),
  idempotency_key       TEXT NOT NULL UNIQUE,        -- LEAD-05/07
  price_paise           BIGINT NOT NULL,
  paid_with             TEXT NOT NULL CHECK (paid_with IN ('INCLUDED_CREDIT','PURCHASED_CREDIT','CHARGE')),
  consent_snapshot      JSONB NOT NULL DEFAULT '{}',
  revealed_fields       JSONB NOT NULL DEFAULT '[]',
  attributed_partner_id TEXT REFERENCES partner(id), -- S-09: snapshot, never re-derived at payout
  attributed_site_id    TEXT REFERENCES partner_site(id),
  attribution_snapshot  JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL CHECK (status IN ('CONFIRMED','REPLACED')),
  unlocked_by           TEXT NOT NULL,
  unlocked_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (employer_id, job_id, candidate_id)         -- LEAD-07 charge once
);

CREATE TABLE credit_ledger (
  id              TEXT PRIMARY KEY,
  entitlement_id  TEXT NOT NULL REFERENCES posting_entitlement(id),
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('OPENING','INCLUDED_GRANT','PURCHASE','UNLOCK_CONSUME','REPLACEMENT_RESTORE','EXPIRY')),
  credit_delta    INT NOT NULL,
  amount_paise    BIGINT NOT NULL DEFAULT 0,
  unlock_id       TEXT REFERENCES qualified_lead_unlock(id),
  linked_entry_id TEXT REFERENCES credit_ledger(id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE replacement_case (
  id              TEXT PRIMARY KEY,
  unlock_id       TEXT NOT NULL REFERENCES qualified_lead_unlock(id),
  reason_code     TEXT NOT NULL CHECK (reason_code IN ('INVALID_CONTACT','NEVER_APPLIED','DUPLICATE_PROFILE')),
  evidence        TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  decided_by      TEXT,
  raised_at       TIMESTAMPTZ NOT NULL,
  window_ends_at  TIMESTAMPTZ NOT NULL,          -- LEAD-08 72h
  decided_at      TIMESTAMPTZ
);

CREATE TABLE reward_ledger (
  id              TEXT PRIMARY KEY,
  partner_id      TEXT NOT NULL REFERENCES partner(id),
  unlock_id       TEXT REFERENCES qualified_lead_unlock(id),
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('ACCRUAL','REVERSAL','PAYOUT','ADJUSTMENT')),
  amount_paise    BIGINT NOT NULL,               -- signed
  status          TEXT NOT NULL CHECK (status IN ('IN_HOLD','ELIGIBLE','APPROVED','PAID','REVERSED','DISPUTED')),
  hold_until      TIMESTAMPTZ,                   -- REF-05 72h fraud hold
  linked_entry_id TEXT REFERENCES reward_ledger(id),
  payout_id       TEXT,
  fy_label        TEXT NOT NULL,                 -- s.194H cumulative tracking per FY
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE payout (
  id                TEXT PRIMARY KEY,
  partner_id        TEXT NOT NULL REFERENCES partner(id),
  gross_paise       BIGINT NOT NULL,
  tds_paise         BIGINT NOT NULL DEFAULT 0,   -- s.194H 2%, 20% without PAN
  tds_rate_bp       INT NOT NULL DEFAULT 0,
  net_paise         BIGINT NOT NULL,
  batch_key         TEXT NOT NULL,               -- WEEKLY_FRIDAY
  status            TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','SIMULATED_PAID','FAILED')),
  provider_ref      TEXT,
  approved_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  paid_at           TIMESTAMPTZ
);

CREATE TABLE optional_outcome_event (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES application(id),
  outcome         TEXT NOT NULL CHECK (outcome IN ('CONTACTED','INTERVIEW_SCHEDULED','INTERVIEW_ATTENDED','REJECTED','SELECTED','JOINED')),
  actor           TEXT NOT NULL,
  source          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE interview (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES application(id),
  scheduled_at    TIMESTAMPTZ,
  format          TEXT,
  location_note   TEXT,
  candidate_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  attended        BOOLEAN,
  outcome         TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE onboarding_case (
  id                TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES application(id),
  offer_fixed_paise BIGINT,
  offer_variable_paise BIGINT,
  joining_date      DATE,
  offer_expires_at  TIMESTAMPTZ,
  checklist         JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'OFFER_SENT',
  created_at        TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Messaging, audit, fraud
-- ---------------------------------------------------------------------------
CREATE TABLE message_template (
  key             TEXT NOT NULL,
  language        TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('SERVICE','UTILITY','MARKETING','AUTHENTICATION')),
  body            TEXT NOT NULL,
  buttons         JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (key, language)
);

CREATE TABLE message_log (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT REFERENCES candidate(id),
  direction       TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  template_key    TEXT,
  language        TEXT,
  category        TEXT,
  body            TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'SIMULATED_DELIVERED',
  cost_paise      BIGINT NOT NULL DEFAULT 0,     -- modelled, never charged in demo
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  actor           TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  event           TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  reason          TEXT,
  detail          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE fraud_case (
  id              TEXT PRIMARY KEY,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  signal          TEXT NOT NULL,
  detail          JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  resolution      TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

-- Versioned commercial policy (§22.2) — no currency amount hardcoded in app logic
CREATE TABLE commercial_policy (
  id                          TEXT PRIMARY KEY,
  version                     TEXT NOT NULL,
  posting_fee_paise           BIGINT NOT NULL,
  included_unlock_credits     INT NOT NULL,
  additional_credit_paise     BIGINT NOT NULL,
  max_distinct_unlocks_per_job INT NOT NULL,
  partner_reward_paise        BIGINT NOT NULL,
  partner_reward_hold_hours   INT NOT NULL,
  replacement_window_hours    INT NOT NULL,
  attribution_window_days     INT NOT NULL,
  partner_payout_minimum_paise BIGINT NOT NULL,
  payout_cadence              TEXT NOT NULL,
  credit_expiry_days          INT NOT NULL,
  preview_batch_size          INT NOT NULL,
  job_expiry_days             INT NOT NULL,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_app_job ON application(job_id, status);
CREATE INDEX idx_match_job ON match_result(job_id, qualified, score DESC);
CREATE INDEX idx_reward_partner ON reward_ledger(partner_id, status);
CREATE INDEX idx_credit_ent ON credit_ledger(entitlement_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_msg_cand ON message_log(candidate_id, created_at);
