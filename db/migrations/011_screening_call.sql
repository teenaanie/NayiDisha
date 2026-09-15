-- QR-driven screening journey.
--
-- A candidate scans a printed code, consents, and is screened by a voice agent.
-- Which agent depends on the configured provider: in-browser (free, no
-- telephony) or a real outbound call through a vendor such as Raya.

-- Being phoned by an automated agent is not covered by PROCESSING (job
-- matching) or JOB_ALERTS (messages). It gets its own purpose so it can be
-- granted and withdrawn on its own, and so no dial can happen without it.
ALTER TABLE app.consent_record DROP CONSTRAINT consent_record_purpose_check;
ALTER TABLE app.consent_record ADD CONSTRAINT consent_record_purpose_check
  CHECK (purpose IN ('PROCESSING','PARTNER_ASSISTANCE','JOB_ALERTS','DOCUMENTS','PRECISE_LOCATION','VOICE_SCREENING'));

CREATE TABLE app.screening_call (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES app.candidate(id),
  partner_site_id TEXT REFERENCES app.partner_site(id),   -- which QR started it
  provider        TEXT NOT NULL,
  provider_ref    TEXT,                                   -- vendor's own call id
  language        TEXT NOT NULL CHECK (language IN ('en','hi','mr')),
  status          TEXT NOT NULL CHECK (status IN ('REQUESTED','IN_PROGRESS','COMPLETED','FAILED','NO_ANSWER','CONSENT_MISSING')),
  status_reason   TEXT,
  extracted       JSONB NOT NULL DEFAULT '{}',            -- structured profile fields
  summary         TEXT,
  -- Where the vendor stores audio, if it does. The in-browser provider never
  -- produces one: audio stays on the device. Erasure must reach this.
  recording_ref   TEXT,
  duration_sec    INT,
  requested_at    TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_screening_call_candidate ON app.screening_call(candidate_id, requested_at DESC);
CREATE UNIQUE INDEX idx_screening_call_ref ON app.screening_call(provider, provider_ref) WHERE provider_ref IS NOT NULL;
