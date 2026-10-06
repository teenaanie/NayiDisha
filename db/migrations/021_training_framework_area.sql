-- The training agent also reviews the assessment framework itself (rubric anchors, checks,
-- weights, the evaluator guide, risk rules), as its own suggestion area.
ALTER TABLE rp.training_suggestion DROP CONSTRAINT IF EXISTS training_suggestion_area_check;
ALTER TABLE rp.training_suggestion ADD CONSTRAINT training_suggestion_area_check
  CHECK (area IN ('customer_replies','question_understanding','scenario_content','assessment','coaching','assessment_framework','other'));
