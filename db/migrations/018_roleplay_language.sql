-- 018: conversation language per practice session (Hindi and Marathi alongside English).
-- The learner picks it at the start; retries inherit it. Existing sessions are English.
ALTER TABLE rp.session
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
  CHECK (language IN ('en', 'hi', 'mr'));
