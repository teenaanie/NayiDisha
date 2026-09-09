import { sql } from '@/lib/db';

/**
 * Configuration service (§8.4A).
 *
 * Everything industry-specific — fields, skills, assessments, thresholds,
 * weights, preview/unlock field lists, document checklists — is read from here
 * as data. No BFSI concept exists as a column or a branch anywhere in the
 * domain, which is the §2.1 platform-core rule.
 */

export interface ScoringWeights {
  jobPreference: number;
  commute: number;
  compensation: number;
  schedule: number;
  language: number;
  experience: number;
  criticalSkills: number;
  assessment: number;
}

export interface QualificationRules {
  minAge18: boolean;
  requireReconfirmation: boolean;
  requireMobileVerified: boolean;
  requireMandatoryProfile: boolean;
  requireWorkAuthDeclaration: boolean;
  requireLanguageMatch: boolean;
  requireSalaryCompatible: boolean;
  requireShiftCompatible: boolean;
  minAssessmentScore: number | null;
}

export interface RoleConfig {
  id: string;
  industryKey: string;
  roleFamilyKey: string;
  version: string;
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'RETIRED' | 'SANDBOX';
  candidateAttributes: { key: string; required: boolean }[];
  jobAttributes: { key: string; required: boolean }[];
  criticalSkills: string[];
  qualificationRules: QualificationRules;
  scoringWeights: ScoringWeights;
  endorsementCap: number;
  assessmentTemplateId: string | null;
  assessmentThreshold: number | null;
  previewFields: string[];
  unlockFields: string[];
  documentChecklist: string[];
}

interface Row {
  id: string; industry_key: string; role_family_key: string; version: string;
  status: RoleConfig['status'];
  candidate_attributes: RoleConfig['candidateAttributes'];
  job_attributes: RoleConfig['jobAttributes'];
  critical_skills: string[];
  qualification_rules: QualificationRules;
  scoring_weights: ScoringWeights;
  endorsement_cap: number;
  assessment_template_id: string | null;
  assessment_threshold: number | null;
  preview_fields: string[];
  unlock_fields: string[];
  document_checklist: string[];
}

const hydrate = (r: Row): RoleConfig => ({
  id: r.id,
  industryKey: r.industry_key,
  roleFamilyKey: r.role_family_key,
  version: r.version,
  status: r.status,
  candidateAttributes: r.candidate_attributes,
  jobAttributes: r.job_attributes,
  criticalSkills: r.critical_skills,
  qualificationRules: r.qualification_rules,
  scoringWeights: r.scoring_weights,
  endorsementCap: r.endorsement_cap,
  assessmentTemplateId: r.assessment_template_id,
  assessmentThreshold: r.assessment_threshold,
  previewFields: r.preview_fields,
  unlockFields: r.unlock_fields,
  documentChecklist: r.document_checklist,
});

export async function getRoleConfig(id: string, conn = sql): Promise<RoleConfig> {
  const [row] = await conn<Row[]>`SELECT * FROM app.role_configuration WHERE id = ${id}`;
  if (!row) throw new Error(`Role configuration ${id} not found`);
  return hydrate(row);
}

export async function listRoleConfigs(): Promise<RoleConfig[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM app.role_configuration ORDER BY industry_key, role_family_key, version
  `;
  return rows.map(hydrate);
}

/**
 * CFG-07 — an industry package must pass validation before publication.
 * Runs schema validation, weight arithmetic, translation completeness and
 * assessment presence. This is what the ops console calls before Publish.
 */
export interface ValidationResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export async function validateRoleConfig(id: string): Promise<ValidationResult> {
  const cfg = await getRoleConfig(id);
  const checks: ValidationResult['checks'] = [];

  const weightTotal = Object.values(cfg.scoringWeights).reduce((a, b) => a + b, 0);
  checks.push({
    name: 'Scoring weights total 100',
    ok: weightTotal === 100,
    detail: `sum = ${weightTotal}`,
  });

  checks.push({
    name: 'Endorsement cap within END-07 ceiling (10% of score)',
    ok: cfg.endorsementCap <= 10,
    detail: `cap = ${cfg.endorsementCap} points of a 100-point scale`,
  });

  const attrKeys = [...cfg.candidateAttributes, ...cfg.jobAttributes].map((a) => a.key);
  const known = await sql<{ key: string }[]>`
    SELECT key FROM app.attribute_definition WHERE key = ANY(${attrKeys})
  `;
  const missing = attrKeys.filter((k) => !known.some((r) => r.key === k));
  checks.push({
    name: 'All referenced attributes are defined',
    ok: missing.length === 0,
    detail: missing.length ? `undefined: ${missing.join(', ')}` : `${attrKeys.length} attributes resolved`,
  });

  if (cfg.assessmentTemplateId) {
    const [tpl] = await sql<{ id: string; languages: string[] }[]>`
      SELECT id, languages FROM app.assessment_template WHERE id = ${cfg.assessmentTemplateId}
    `;
    checks.push({
      name: 'Assessment template exists',
      ok: !!tpl,
      detail: tpl ? `${tpl.id} in ${tpl.languages.join('/')}` : 'not found',
    });
    checks.push({
      name: 'Assessment available in all launch languages (mr/hi/en)',
      ok: !!tpl && ['mr', 'hi', 'en'].every((l) => tpl.languages.includes(l)),
      detail: tpl ? tpl.languages.join(', ') : '—',
    });
  }

  checks.push({
    name: 'Preview fields exclude contact data (LEAD-02)',
    ok: !cfg.previewFields.some((f) => ['phone', 'email', 'full_name'].includes(f)),
    detail: cfg.previewFields.join(', '),
  });

  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * CFG-04/10 — publish a configuration. Published versions are immutable;
 * a change creates a new version. Only a platform administrator may publish.
 */
export async function publishRoleConfig(
  id: string, actor: string, at: Date,
): Promise<ValidationResult> {
  const result = await validateRoleConfig(id);
  if (!result.ok) return result;
  await sql`
    UPDATE app.role_configuration
       SET status = 'PUBLISHED', effective_from = ${at}
     WHERE id = ${id} AND status IN ('DRAFT','REVIEW','SANDBOX')
  `;
  await sql`
    INSERT INTO app.audit_log (id, actor, actor_role, event, entity_type, entity_id, reason, detail, created_at)
    VALUES (
      ${'AUD-' + Date.now()}, ${actor}, 'PLATFORM_ADMIN', 'CONFIG_PUBLISHED',
      'role_configuration', ${id}, 'CFG-04 publish', ${sql.json(result as never)}, ${at}
    )
  `;
  return result;
}

export async function activeCommercialPolicy() {
  const [row] = await sql<{
    id: string; version: string;
    posting_fee_paise: string; included_unlock_credits: number;
    additional_credit_paise: string; max_distinct_unlocks_per_job: number;
    partner_reward_paise: string; partner_reward_hold_hours: number;
    replacement_window_hours: number; attribution_window_days: number;
    partner_payout_minimum_paise: string; payout_cadence: string;
    credit_expiry_days: number; preview_batch_size: number; job_expiry_days: number;
  }[]>`SELECT * FROM app.commercial_policy WHERE active = TRUE LIMIT 1`;
  if (!row) throw new Error('No active commercial policy');
  return {
    id: row.id,
    version: row.version,
    postingFeePaise: Number(row.posting_fee_paise),
    includedUnlockCredits: row.included_unlock_credits,
    additionalCreditPaise: Number(row.additional_credit_paise),
    maxDistinctUnlocksPerJob: row.max_distinct_unlocks_per_job,
    partnerRewardPaise: Number(row.partner_reward_paise),
    partnerRewardHoldHours: row.partner_reward_hold_hours,
    replacementWindowHours: row.replacement_window_hours,
    attributionWindowDays: row.attribution_window_days,
    partnerPayoutMinimumPaise: Number(row.partner_payout_minimum_paise),
    payoutCadence: row.payout_cadence,
    creditExpiryDays: row.credit_expiry_days,
    previewBatchSize: row.preview_batch_size,
    jobExpiryDays: row.job_expiry_days,
  };
}
export type CommercialPolicy = Awaited<ReturnType<typeof activeCommercialPolicy>>;
