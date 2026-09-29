-- Voice practice for the roleplay platform (spec §3: "Voice can later use the
-- same turn contract with ASR provenance and learner correction before final
-- evaluation").
--
-- A spoken turn is still an ordinary committed learner turn, and its text is
-- what the learner confirmed after reading the transcript, so evidence and
-- scoring are unchanged. This table records how that text was produced:
-- which speech recogniser heard it, exactly what it heard, and whether the
-- learner corrected it. Audio is never stored.

CREATE TABLE rp.turn_input (
  turn_id        UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  session_id     UUID NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('voice')),
  asr_provider   TEXT NOT NULL,            -- e.g. browser:webspeech, sarvam:saarika
  asr_text       TEXT NOT NULL,            -- what the recogniser produced, before correction
  asr_confidence NUMERIC(4,3),
  language       TEXT NOT NULL,
  edited         BOOLEAN NOT NULL,         -- the learner changed the transcript before sending
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES rp.turn(tenant_id, id)
);
CREATE INDEX idx_rp_turn_input_session ON rp.turn_input(session_id);

-- Speaking to the practice coach sends audio to a speech service (the
-- browser vendor's, or the configured server provider's). That is a separate
-- choice from practising by text, so it has its own consent.
CREATE TABLE rp.voice_consent (
  user_id        UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  notice_version TEXT NOT NULL,
  granted_at     TIMESTAMPTZ,
  withdrawn_at   TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, user_id) REFERENCES rp.app_user(tenant_id, id)
);
