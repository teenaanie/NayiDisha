import { sql } from '@/lib/db';
import { now } from '@/lib/clock';
import { nextId } from '@/lib/ids';
import { getRoleConfig, RoleConfig } from '@/modules/configuration';
import { travelProvider, TravelEstimate } from '@/modules/adapters/travel';

/**
 * Matching and qualification engine (§8.7).
 *
 * Three stages, in order:
 *   Stage A — hard eligibility. Fail here and the candidate is not eligible.
 *   Stage B — qualified-profile validation. Passing both makes the candidate a
 *             "Qualified Profile" for this specific live job (MATCH-08).
 *   Stage C — weighted ranking from the published role configuration.
 *
 * Every result stores the rule version and the exact inputs used, so a match
 * explanation reproduces years later even after the configuration moves on
 * (MATCH-06, CFG-05, §25).
 *
 * Deterministic by construction: no randomness, no wall clock, no external
 * call that can vary.
 */

export const RULE_VERSION = 'match-engine@1.3.0';

export interface StageOutcome {
  pass: boolean;
  reasons: string[];
}

export interface MatchComputation {
  stageA: StageOutcome;
  stageB: StageOutcome;
  qualified: boolean;
  score: number | null;
  components: Record<string, { raw: number; weight: number; weighted: number }>;
  endorsementPoints: number;
  explanation: string[];
  gaps: string[];
  travel: TravelEstimate | null;
  inputs: Record<string, unknown>;
}

interface CandidateRow {
  id: string; name: string | null; locality_key: string | null;
  age_confirmed_18: boolean; experience_months: number; experience_tags: string[];
  languages: string[]; expected_pay_paise: string | null; current_pay_paise: string | null;
  max_commute_min: number; shift_availability: string[]; status: string;
  mobile_verified_at: Date | null;
}

interface JobRow {
  id: string; employer_id: string; location_id: string; role_config_id: string;
  title: string; openings: number; fixed_pay_paise: string; variable_max_paise: string;
  shift: string; languages: string[]; min_experience_mo: number;
  critical_skills: string[]; status: string; expires_at: Date | null;
  lat: number; lng: number; loc_locality: string; loc_name: string;
}

/** 0–100 sub-scores. Each is deliberately discriminating rather than generous. */
function scoreCommute(t: TravelEstimate | null): number {
  if (!t) return 0;
  switch (t.band) {
    case 'CLOSE': return 100;
    case 'MODERATE': return 70;
    case 'LONG': return 35;
    default: return 10;
  }
}

function scoreCompensation(expected: number | null, fixed: number, variableMax: number): number {
  if (expected === null) return 60;
  if (expected <= fixed) return 100;
  const overFixed = expected - fixed;
  if (variableMax <= 0) return 0;
  // Reachable only through variable pay: the further into the variable band the
  // expectation sits, the weaker the fit — a frontline worker who needs the
  // variable to hit their number is the one most likely to leave.
  const ratio = Math.min(overFixed / variableMax, 1);
  return Math.round(80 - ratio * 60);
}

function scoreExperience(months: number, minMonths: number): number {
  if (months === 0) return minMonths === 0 ? 60 : 25;
  const target = Math.max(minMonths, 12);
  return Math.round(Math.min(months / target, 1) * 100);
}

function scoreSkills(candidateTags: string[], criticalSkills: string[],
                     transferable: Record<string, string[]>): number {
  if (criticalSkills.length === 0) return 70;
  let hit = 0;
  for (const skill of criticalSkills) {
    if (candidateTags.includes(skill)) { hit += 1; continue; }
    const alts = transferable[skill] ?? [];
    if (alts.some((a) => candidateTags.includes(a))) hit += 0.6; // transferable, CFG-08
  }
  return Math.round((hit / criticalSkills.length) * 100);
}

function scoreLanguage(candidateLangs: string[], required: string[]): number {
  if (required.length === 0) return 100;
  const hit = required.filter((l) => candidateLangs.includes(l)).length;
  return Math.round((hit / required.length) * 100);
}

function scoreJobPreference(tags: string[], roleFamily: string): number {
  const direct: Record<string, string[]> = {
    RELATIONSHIP_EXECUTIVE: ['BFSI_SALES', 'FIELD_SALES'],
    CUSTOMER_SERVICE_ASSOCIATE: ['CUSTOMER_SERVICE', 'BFSI_SERVICE'],
    SALES_ASSOCIATE: ['RETAIL_SALES', 'SALES'],
  };
  const adjacent = ['SALES', 'TELECOM_SALES', 'RETAIL_SALES', 'CUSTOMER_SERVICE', 'COMMERCE_GRADUATE'];
  if ((direct[roleFamily] ?? []).some((t) => tags.includes(t))) return 100;
  if (tags.some((t) => adjacent.includes(t))) return 65;
  return 35;
}

const TRANSFERABLE: Record<string, string[]> = {
  BFSI_SALES: ['FIELD_SALES', 'TELECOM_SALES', 'SALES'],
  CUSTOMER_COMMUNICATION: ['CUSTOMER_SERVICE', 'BFSI_SERVICE', 'RETAIL_SALES'],
  TARGET_ACHIEVEMENT: ['FIELD_SALES', 'TELECOM_SALES', 'RETAIL_SALES'],
  PRODUCT_KNOWLEDGE: ['BFSI_SERVICE', 'COMMERCE_GRADUATE'],
};

export async function computeMatch(
  candidateId: string, jobId: string,
): Promise<MatchComputation> {
  const [cand] = await sql<CandidateRow[]>`
    SELECT * FROM app.candidate WHERE id = ${candidateId}
  `;
  const [job] = await sql<JobRow[]>`
    SELECT j.*, l.lat, l.lng, l.locality_key AS loc_locality, l.name AS loc_name
      FROM app.job j JOIN app.employer_location l ON l.id = j.location_id
     WHERE j.id = ${jobId}
  `;
  if (!cand || !job) throw new Error(`Cannot match ${candidateId} against ${jobId}`);

  const cfg: RoleConfig = await getRoleConfig(job.role_config_id);
  const rules = cfg.qualificationRules;
  const at = await now();

  const [app] = await sql<{ status: string; reconfirmed_at: Date | null }[]>`
    SELECT status, reconfirmed_at FROM app.application
     WHERE candidate_id = ${candidateId} AND job_id = ${jobId}
  `;
  const [consent] = await sql<{ granted_at: Date | null; withdrawn_at: Date | null }[]>`
    SELECT granted_at, withdrawn_at FROM app.consent_record
     WHERE candidate_id = ${candidateId} AND purpose = 'PROCESSING'
  `;
  const [attempt] = await sql<{ score: number; template_version: string }[]>`
    SELECT score, template_version FROM app.assessment_attempt
     WHERE candidate_id = ${candidateId}
     ORDER BY completed_at DESC LIMIT 1
  `;
  const endorsements = await sql<{ raw_points: number; status: string }[]>`
    SELECT raw_points, status FROM app.endorsement
     WHERE candidate_id = ${candidateId} AND status = 'VERIFIED_CONTACT'
     ORDER BY raw_points DESC LIMIT 2
  `;

  const fixed = Number(job.fixed_pay_paise);
  const variableMax = Number(job.variable_max_paise);
  const expected = cand.expected_pay_paise === null ? null : Number(cand.expected_pay_paise);

  const travel = cand.locality_key
    ? await travelProvider().between(cand.locality_key, job.lat, job.lng)
    : null;

  // ---- Stage A: hard eligibility ------------------------------------------
  const aReasons: string[] = [];
  const jobLive = job.status === 'LIVE' && (!job.expires_at || job.expires_at > at);
  if (!jobLive) aReasons.push('JOB_NOT_LIVE');
  if (rules.minAge18 && !cand.age_confirmed_18) aReasons.push('AGE_NOT_CONFIRMED_18');
  if (!consent?.granted_at || consent.withdrawn_at) aReasons.push('PROCESSING_CONSENT_ABSENT');
  if (app?.status === 'REJECTED' || app?.status === 'WITHDRAWN') aReasons.push('PRIOR_REJECTION_OR_WITHDRAWAL');
  if (travel && travel.minutes > cand.max_commute_min) aReasons.push('COMMUTE_EXCEEDS_CANDIDATE_LIMIT');
  if (rules.requireShiftCompatible &&
      cand.shift_availability.length > 0 &&
      !cand.shift_availability.includes(job.shift) &&
      !cand.shift_availability.includes('ANY')) {
    aReasons.push('SHIFT_INCOMPATIBLE');
  }
  // Salary compatibility per §22.1: total reachable pay must meet the
  // expectation. Expectations above fixed pay still pass but are surfaced as a
  // SALARY_GAP in the explanation, never hidden.
  if (rules.requireSalaryCompatible && expected !== null && expected > fixed + variableMax) {
    aReasons.push('SALARY_INCOMPATIBLE');
  }
  if (rules.requireLanguageMatch && scoreLanguage(cand.languages, job.languages) === 0) {
    aReasons.push('NO_REQUIRED_LANGUAGE');
  }
  const stageA: StageOutcome = { pass: aReasons.length === 0, reasons: aReasons };

  // ---- Stage B: qualified-profile validation ------------------------------
  const bReasons: string[] = [];
  if (rules.requireMobileVerified && !cand.mobile_verified_at) bReasons.push('MOBILE_NOT_VERIFIED');
  if (rules.requireMandatoryProfile && cand.status !== 'PROFILE_ACTIVE') bReasons.push('PROFILE_INCOMPLETE');
  if (!app) bReasons.push('NO_APPLICATION');
  if (rules.requireReconfirmation && app && !app.reconfirmed_at) bReasons.push('INTEREST_NOT_RECONFIRMED');
  if (rules.minAssessmentScore !== null) {
    if (!attempt) bReasons.push('ASSESSMENT_NOT_TAKEN');
    else if (attempt.score < rules.minAssessmentScore) {
      bReasons.push(`ASSESSMENT_BELOW_${rules.minAssessmentScore}`);
    }
  }
  const stageB: StageOutcome = { pass: bReasons.length === 0, reasons: bReasons };

  const qualified = stageA.pass && stageB.pass;

  // ---- Stage C: weighted ranking ------------------------------------------
  const w = cfg.scoringWeights;
  const raws: Record<keyof typeof w, number> = {
    jobPreference: scoreJobPreference(cand.experience_tags, cfg.roleFamilyKey),
    commute: scoreCommute(travel),
    compensation: scoreCompensation(expected, fixed, variableMax),
    schedule: cand.shift_availability.includes(job.shift) || cand.shift_availability.includes('ANY') ? 100 : 40,
    language: scoreLanguage(cand.languages, job.languages),
    experience: scoreExperience(cand.experience_months, job.min_experience_mo),
    criticalSkills: scoreSkills(cand.experience_tags, job.critical_skills, TRANSFERABLE),
    assessment: attempt?.score ?? 0,
  };

  const components: MatchComputation['components'] = {};
  let base = 0;
  for (const key of Object.keys(w) as (keyof typeof w)[]) {
    const weighted = (raws[key] * w[key]) / 100;
    components[key] = { raw: raws[key], weight: w[key], weighted: Math.round(weighted * 10) / 10 };
    base += weighted;
  }

  // END-05/07 — raw endorsement points scale down to the configured cap, which
  // is itself bounded at 10% of the score. Ordering boost only, never eligibility.
  const rawEndorsement = endorsements.reduce((s, e) => s + e.raw_points, 0);
  const endorsementPoints = Math.min(
    Math.round((rawEndorsement / 20) * cfg.endorsementCap),
    cfg.endorsementCap,
  );

  const score = qualified ? Math.round(base + endorsementPoints) : null;

  // ---- Explanation (MATCH-03/10) ------------------------------------------
  const explanation: string[] = [];
  const gaps: string[] = [];
  if (travel) {
    if (travel.band === 'CLOSE') explanation.push('CLOSE_COMMUTE');
    else if (travel.band === 'MODERATE') explanation.push('MODERATE_COMMUTE');
    else gaps.push('LONG_COMMUTE');
  }
  if (expected !== null && expected <= fixed) explanation.push('SALARY_FIT');
  else if (expected !== null && expected <= fixed + variableMax) gaps.push('SALARY_GAP');
  if (raws.schedule === 100) explanation.push('SHIFT_FIT');
  if (raws.jobPreference === 100) explanation.push('DIRECT_ROLE_EXPERIENCE');
  else if (raws.jobPreference >= 65) explanation.push('TRANSFERABLE_EXPERIENCE');
  else gaps.push('LIMITED_DIRECT_EXPERIENCE');
  if (raws.criticalSkills >= 80) explanation.push('STRONG_SKILLS');
  else if (raws.criticalSkills < 50) gaps.push('SKILL_GAPS');
  if (attempt && rules.minAssessmentScore !== null) {
    if (attempt.score >= 85) explanation.push('STRONG_ASSESSMENT');
    else if (attempt.score >= rules.minAssessmentScore) explanation.push('ASSESSMENT_PASS');
    else gaps.push(`ASSESSMENT_BELOW_${rules.minAssessmentScore}`);
  }
  if (endorsementPoints > 0) explanation.push('VERIFIED_ENDORSEMENT');
  if (cand.experience_months === 0) gaps.push('FRESHER');
  if (!qualified) gaps.push(...stageA.reasons, ...stageB.reasons);

  return {
    stageA, stageB, qualified, score, components, endorsementPoints,
    explanation: [...new Set(explanation)], gaps: [...new Set(gaps)], travel,
    inputs: {
      candidate: {
        localityKey: cand.locality_key, experienceMonths: cand.experience_months,
        experienceTags: cand.experience_tags, languages: cand.languages,
        expectedPayPaise: expected, maxCommuteMin: cand.max_commute_min,
        shiftAvailability: cand.shift_availability,
      },
      job: {
        fixedPayPaise: fixed, variableMaxPaise: variableMax, shift: job.shift,
        languages: job.languages, minExperienceMo: job.min_experience_mo,
        criticalSkills: job.critical_skills, locality: job.loc_locality,
      },
      assessment: attempt ? { score: attempt.score, templateVersion: attempt.template_version } : null,
      endorsementRawPoints: rawEndorsement,
      travelProvider: travel?.provider ?? null,
      configVersion: `${cfg.id}@${cfg.version}`,
    },
  };
}

/** Compute and persist a match result, version-stamped (MATCH-06). */
export async function recordMatch(
  applicationId: string, candidateId: string, jobId: string,
): Promise<{ id: string; computation: MatchComputation }> {
  const c = await computeMatch(candidateId, jobId);
  const at = await now();
  const [job] = await sql<{ role_config_id: string }[]>`
    SELECT role_config_id FROM app.job WHERE id = ${jobId}
  `;
  const id = await nextId('MATCH');
  await sql`
    INSERT INTO app.match_result (
      id, application_id, candidate_id, job_id, role_config_id, rule_version,
      stage_a_pass, stage_b_pass, qualified, score, score_components,
      endorsement_points, explanation, gaps, inputs_snapshot, computed_at
    ) VALUES (
      ${id}, ${applicationId}, ${candidateId}, ${jobId}, ${job.role_config_id}, ${RULE_VERSION},
      ${c.stageA.pass}, ${c.stageB.pass}, ${c.qualified}, ${c.score},
      ${sql.json(c.components as never)}, ${c.endorsementPoints},
      ${sql.json(c.explanation as never)}, ${sql.json(c.gaps as never)},
      ${sql.json(c.inputs as never)}, ${at}
    )
  `;
  await sql`
    UPDATE app.application
       SET status = ${c.qualified ? 'QUALIFIED' : 'NOT_QUALIFIED'}, status_at = ${at}
     WHERE id = ${applicationId}
  `;
  return { id, computation: c };
}

/**
 * LEAD-01/11 — up to N ranked masked previews for a live job.
 * Never dilutes: if fewer qualify, fewer are returned and a supply-gap flag
 * comes back with them.
 */
export async function previewsForJob(jobId: string, batchSize: number) {
  const rows = await sql<{
    match_id: string; application_id: string; candidate_id: string;
    name: string | null; locality_key: string | null; score: number;
    explanation: string[]; gaps: string[]; endorsement_points: number;
    experience_months: number; experience_tags: string[];
    expected_pay_paise: string | null; inputs_snapshot: Record<string, unknown>;
    unlocked: boolean;
  }[]>`
    SELECT m.id AS match_id, m.application_id, m.candidate_id, c.name, c.locality_key,
           m.score, m.explanation, m.gaps, m.endorsement_points,
           c.experience_months, c.experience_tags, c.expected_pay_paise,
           m.inputs_snapshot,
           EXISTS (SELECT 1 FROM app.qualified_lead_unlock u
                    WHERE u.job_id = m.job_id AND u.candidate_id = m.candidate_id
                      AND u.status = 'CONFIRMED') AS unlocked
      FROM app.match_result m
      JOIN app.candidate c ON c.id = m.candidate_id
      JOIN app.application a ON a.id = m.application_id
     WHERE m.job_id = ${jobId}
       AND m.qualified = TRUE
       AND a.reconfirmed_at IS NOT NULL
       AND a.status NOT IN ('WITHDRAWN','REJECTED')
     ORDER BY m.score DESC, m.candidate_id ASC
     LIMIT ${batchSize}
  `;
  return rows;
}

/** LEAD-02 — first name plus surname initial. Never the reverse. */
export function maskName(full: string | null): string {
  if (!full) return 'Candidate';
  const cleaned = full.replace(/^DEMO\s+/i, '').trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
