-- Graded assessment for the Practice coach.
--
-- After practising, a learner can take a graded assessment of the same scenario:
-- the same customer and the same evaluator, but no coaching. The learner sees
-- only the overall score, the band and each skill's score with its weighted
-- contribution; managers can open the full assessment. One attempt per
-- scenario, unlocked by a practice report; a manager can allow a retake, and
-- every attempt stays on record.

ALTER TABLE rp.session ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'practice'
  CHECK (kind IN ('practice','assessment'));
CREATE INDEX IF NOT EXISTS idx_rp_session_learner_kind ON rp.session(tenant_id, learner_id, scenario_id, kind);

-- One row per retake a manager allows; each lets the learner take one more graded attempt.
CREATE TABLE IF NOT EXISTS rp.assessment_grant (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES rp.tenant(id),
  learner_id   UUID NOT NULL REFERENCES rp.app_user(id),
  scenario_id  TEXT NOT NULL,
  granted_by   UUID NOT NULL REFERENCES rp.app_user(id),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rp_assessment_grant_learner ON rp.assessment_grant(tenant_id, learner_id, scenario_id);
