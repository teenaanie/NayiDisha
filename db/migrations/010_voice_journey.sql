-- Voice journey (candidate answers profile questions by speaking).
--
-- Only the transcript is stored. Audio never leaves the candidate's phone:
-- the browser's own speech recognition produces text and only that text is
-- sent to the server, so there is no recording to retain, disclose or erase.
-- The transcript is candidate personal data and is erased with the rest of the
-- profile by the CAN-06 erasure path.
CREATE TABLE app.voice_turn (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES app.candidate(id),
  field           TEXT NOT NULL,
  language        TEXT NOT NULL CHECK (language IN ('en','hi','mr')),
  transcript      TEXT NOT NULL,
  interpreted     JSONB,
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0,
  provider        TEXT NOT NULL,
  accepted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_voice_turn_candidate ON app.voice_turn(candidate_id, created_at DESC);
