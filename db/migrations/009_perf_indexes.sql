-- Candidate-scoped lookups on these tables ran with no supporting index
-- (a foreign key does not create one in Postgres), forcing a sequential scan
-- on every computeMatch/beginTest/submitTest/resumePoint call as the tables grow.
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_candidate ON app.assessment_attempt(candidate_id, template_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_endorsement_candidate ON app.endorsement(candidate_id, status);
