-- Operators manage graded assessments across the whole tenant.
--
-- Signed-in candidates are not on any team, so no manager sees their graded
-- assessments or can allow a retake. The `operator` role (NayiDisha operations
-- and administrators) sees every learner's assessments in the tenant, opens the
-- full assessment, and sets how many attempts a learner has for a scenario.
-- Lowering the number withdraws unused extra attempts; a withdrawn grant stays
-- on record (revoked_at), so the history is never lost.

ALTER TABLE rp.membership DROP CONSTRAINT IF EXISTS membership_role_check;
ALTER TABLE rp.membership ADD CONSTRAINT membership_role_check
  CHECK (role IN ('learner','manager','author','reviewer','tenant_admin','worker','operator'));

ALTER TABLE rp.assessment_grant ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE rp.assessment_grant ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES rp.app_user(id);

-- The operations user and the demo administrators, where they already exist (the seed adds them otherwise).
INSERT INTO rp.membership (tenant_id, user_id, role)
SELECT u.tenant_id, u.id, 'operator' FROM rp.app_user u JOIN rp.tenant t ON t.id = u.tenant_id
 WHERE t.slug = 'nayidisha' AND (u.subject = 'nd:operations' OR u.subject LIKE 'nd:admin:%')
ON CONFLICT DO NOTHING;
