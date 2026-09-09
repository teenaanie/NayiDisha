-- 002 — alerts, nudges, interviews, onboarding and lifecycle
-- Everything here supports §8.6 (alerts), §8.9 (interviews), §8.10 (onboarding)
-- and the job/endorsement lifecycle clauses that 001 left as bare tables.
SET search_path TO app, public;

-- ---------------------------------------------------------------------------
-- Job alerts (§8.6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_alert (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES job(id),
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  language        TEXT NOT NULL,
  template_key    TEXT NOT NULL,
  -- ALT-04 actions the candidate can take straight from the message
  response        TEXT CHECK (response IN ('VIEW','APPLY','NOT_INTERESTED','STOP_ALERTS','CHANGE_PREFERENCES')),
  responded_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ NOT NULL,
  UNIQUE (job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS partner_job_alert (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES job(id),
  partner_id      TEXT NOT NULL REFERENCES partner(id),
  bounty_paise    BIGINT NOT NULL,       -- REF-04, shown before sourcing
  sent_at         TIMESTAMPTZ NOT NULL,
  UNIQUE (job_id, partner_id)
);

-- ALT-02 — candidate alert preferences: quiet hours and frequency caps
ALTER TABLE candidate ADD COLUMN IF NOT EXISTS alert_quiet_from INT NOT NULL DEFAULT 21;  -- 21:00 IST
ALTER TABLE candidate ADD COLUMN IF NOT EXISTS alert_quiet_to   INT NOT NULL DEFAULT 8;   -- 08:00 IST
ALTER TABLE candidate ADD COLUMN IF NOT EXISTS alert_max_per_week INT NOT NULL DEFAULT 5;

-- ---------------------------------------------------------------------------
-- Job lifecycle (JOB-01/04/05)
-- ---------------------------------------------------------------------------
ALTER TABLE job ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE job ADD COLUMN IF NOT EXISTS duplicated_from TEXT REFERENCES job(id);
ALTER TABLE job ADD COLUMN IF NOT EXISTS last_material_change_at TIMESTAMPTZ;
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_status_check;
ALTER TABLE job ADD CONSTRAINT job_status_check CHECK (status IN
  ('DRAFT','PENDING_APPROVAL','LIVE','PAUSED','FILLED','CLOSED','EXPIRED','SUSPENDED','ARCHIVED'));

-- JOB-04 — a material edit is recorded, not just applied
CREATE TABLE IF NOT EXISTS job_change (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES job(id),
  field           TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  material        BOOLEAN NOT NULL,
  actor           TEXT NOT NULL,
  notified_count  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Endorsements (END-02/03/09)
-- ---------------------------------------------------------------------------
ALTER TABLE endorsement ADD COLUMN IF NOT EXISTS withdraw_token TEXT;
ALTER TABLE endorsement ADD COLUMN IF NOT EXISTS hidden_by_candidate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE endorsement ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
ALTER TABLE endorsement ADD COLUMN IF NOT EXISTS display_consent BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Interviews (§8.9)
-- ---------------------------------------------------------------------------
ALTER TABLE interview ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PROPOSED';
ALTER TABLE interview ADD COLUMN IF NOT EXISTS safety_note TEXT;
ALTER TABLE interview ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE interview ADD COLUMN IF NOT EXISTS rescheduled_from TIMESTAMPTZ;
ALTER TABLE interview ADD COLUMN IF NOT EXISTS no_show_by TEXT;
ALTER TABLE interview DROP CONSTRAINT IF EXISTS interview_status_check;
ALTER TABLE interview ADD CONSTRAINT interview_status_check CHECK (status IN
  ('PROPOSED','CONFIRMED','DECLINED','RESCHEDULED','ATTENDED','NO_SHOW_CANDIDATE','NO_SHOW_EMPLOYER','CANCELLED'));

-- ---------------------------------------------------------------------------
-- Onboarding (§8.10)
-- ---------------------------------------------------------------------------
ALTER TABLE onboarding_case DROP CONSTRAINT IF EXISTS onboarding_case_status_check;
ALTER TABLE onboarding_case ADD CONSTRAINT onboarding_case_status_check CHECK (status IN
  ('OFFER_SENT','OFFER_ACCEPTED','OFFER_DECLINED','OFFER_EXPIRED','DOCUMENTS_PENDING','DOCUMENTS_COMPLETE','JOINED','CANCELLED'));
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS role_title TEXT;
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES employer_location(id);
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- CandidateDocument is named in the §12 data model but was never created in
-- 001 — that was an omission, not a decision. Created here.
--
-- ONB-04 — documents are referenced, never stored inline. In production the
-- reference points at private object storage behind short-lived signed URLs;
-- in the prototype it points at a watermarked placeholder. Partners can never
-- read this table, and operations access needs a separate support purpose.
CREATE TABLE IF NOT EXISTS candidate_document (
  id                  TEXT PRIMARY KEY,
  onboarding_case_id  TEXT NOT NULL REFERENCES onboarding_case(id),
  candidate_id        TEXT NOT NULL REFERENCES candidate(id),
  document_key        TEXT NOT NULL REFERENCES document_definition(key),
  object_ref          TEXT,
  access_policy       TEXT NOT NULL DEFAULT 'EMPLOYER_CASE_SCOPED',
  retention_days      INT NOT NULL DEFAULT 365,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','UPLOADED','APPROVED','REJECTED')),
  reject_reason       TEXT,
  uploaded_at         TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL,
  UNIQUE (onboarding_case_id, document_key)
);

-- ---------------------------------------------------------------------------
-- Partner conduct rules (PART-07)
-- ---------------------------------------------------------------------------
ALTER TABLE partner ADD COLUMN IF NOT EXISTS conduct_accepted_at TIMESTAMPTZ;
ALTER TABLE partner ADD COLUMN IF NOT EXISTS conduct_version TEXT;

-- ---------------------------------------------------------------------------
-- Candidate rights requests (CAN-06)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_request (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidate(id),
  kind            TEXT NOT NULL CHECK (kind IN ('ACCESS','CORRECTION','ERASURE')),
  detail          TEXT,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACTIONED','REFUSED')),
  -- DPDP Rules 2025 require a response within 90 days; the due date is stored
  -- so the operations queue can be sorted by what is closest to breaching.
  due_at          TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_cand ON job_alert(candidate_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_itv_app ON interview(application_id);
CREATE INDEX IF NOT EXISTS idx_doc_case ON candidate_document(onboarding_case_id);
