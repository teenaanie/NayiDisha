-- Additive upgrade: never resets existing demo data.
CREATE TABLE IF NOT EXISTS app.id_counter (prefix text PRIMARY KEY, value bigint NOT NULL);
ALTER TABLE app.job ADD COLUMN IF NOT EXISTS pending_changes jsonb;
ALTER TABLE app.job ADD COLUMN IF NOT EXISTS requirements jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.partner_site ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE app.partner_site ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE app.partner_site ADD COLUMN IF NOT EXISTS suspended_by_partner boolean NOT NULL DEFAULT false;
ALTER TABLE app.candidate ADD COLUMN IF NOT EXISTS pending_source jsonb;
ALTER TABLE app.candidate ADD COLUMN IF NOT EXISTS role_config_id text REFERENCES app.role_configuration(id);
ALTER TABLE app.candidate ADD COLUMN IF NOT EXISTS work_authorised boolean NOT NULL DEFAULT false;
ALTER TABLE app.assessment_template ADD COLUMN IF NOT EXISTS retake_hours integer NOT NULL DEFAULT 24;
ALTER TABLE app.assessment_template ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS app.assessment_session (
 id text PRIMARY KEY, candidate_id text NOT NULL REFERENCES app.candidate(id),
 template_id text NOT NULL REFERENCES app.assessment_template(id), template_version text NOT NULL,
 language text NOT NULL, question_ids jsonb NOT NULL, started_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, completed_at timestamptz
);
ALTER TABLE app.commercial_policy ADD COLUMN IF NOT EXISTS salary_basis text NOT NULL DEFAULT 'TOTAL' CHECK (salary_basis IN ('FIXED','TOTAL'));
ALTER TABLE app.commercial_policy ADD COLUMN IF NOT EXISTS endorsement_cap integer NOT NULL DEFAULT 5 CHECK (endorsement_cap BETWEEN 0 AND 10);
CREATE TABLE IF NOT EXISTS app.payout_recovery (
 id text PRIMARY KEY, partner_id text NOT NULL REFERENCES app.partner(id),
 reversal_id text NOT NULL UNIQUE REFERENCES app.reward_ledger(id), amount_paise bigint NOT NULL CHECK (amount_paise>0),
 recovered_paise bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL,
 CHECK(recovered_paise BETWEEN 0 AND amount_paise)
);
CREATE TABLE IF NOT EXISTS app.payout_recovery_offset (
 payout_id text NOT NULL REFERENCES app.payout(id), recovery_id text NOT NULL REFERENCES app.payout_recovery(id),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), PRIMARY KEY(payout_id,recovery_id)
);
ALTER TABLE app.payout ADD COLUMN IF NOT EXISTS recovery_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE app.payout ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE app.message_log ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'DELIVERED';
ALTER TABLE app.message_log ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
ALTER TABLE app.message_log ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE app.demo_clock ADD COLUMN IF NOT EXISTS messaging_failure boolean NOT NULL DEFAULT false;
ALTER TABLE app.demo_clock ADD COLUMN IF NOT EXISTS payout_failure boolean NOT NULL DEFAULT false;
ALTER TABLE app.data_request ADD COLUMN IF NOT EXISTS response jsonb;
CREATE TABLE IF NOT EXISTS app.action_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, role text NOT NULL,
 action text NOT NULL, entity_id text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
-- Historical payout rows were incorrectly reclassified by the old application.
UPDATE app.reward_ledger SET entry_type='ACCRUAL' WHERE entry_type='PAYOUT' AND unlock_id IS NOT NULL;
