import {sql} from '@/lib/db';
export async function dashboardData(){
 const [counts]=await sql`SELECT
 (SELECT count(*) FROM app.candidate) candidates,
 (SELECT count(DISTINCT candidate_id) FROM app.assessment_attempt) assessed,
 (SELECT count(*) FROM app.candidate c WHERE NOT EXISTS(SELECT 1 FROM app.assessment_attempt a WHERE a.candidate_id=c.id)) awaiting_assessment,
 (SELECT count(*) FROM app.application WHERE reconfirmed_at IS NOT NULL) applications,
 (SELECT count(DISTINCT candidate_id) FROM app.application) applied_candidates,
 (SELECT count(DISTINCT candidate_id) FROM app.application WHERE status IN ('SELECTED','JOINED')) selected_candidates,
 (SELECT count(DISTINCT candidate_id) FROM app.application WHERE status='JOINED') hired_candidates,
 (SELECT count(*) FROM app.job WHERE status IN ('CLOSED','FILLED','EXPIRED')) closed_jobs,
 (SELECT count(*) FROM app.job_suggestion WHERE eligible AND NOT hidden) suggestions,
 (SELECT count(*) FROM app.application WHERE reconfirmed_at IS NULL AND status NOT IN ('WITHDRAWN','REJECTED','JOINED')) awaiting_interest,
 (SELECT count(*) FROM app.attribution WHERE partner_id IS NOT NULL) referrals,
 (SELECT count(*) FROM app.qualified_lead_unlock WHERE status='CONFIRMED') unlocks,
 (SELECT coalesce(sum(amount_paise),0) FROM app.reward_ledger WHERE entry_type='ACCRUAL' AND status<>'REVERSED') referral_paise,
 (SELECT count(*) FROM app.employer_organisation WHERE status='PENDING_REVIEW') emp_pending,
 (SELECT count(*) FROM app.partner WHERE status='PENDING_REVIEW') par_pending,
 (SELECT count(*) FROM app.job WHERE status='PENDING_APPROVAL') job_pending,
 (SELECT count(*) FROM app.attribution WHERE status='UNDER_REVIEW') attr_review,
 (SELECT count(*) FROM app.replacement_case WHERE decision='PENDING') repl_pending,
 (SELECT count(*) FROM app.fraud_case WHERE status='OPEN') fraud_open,
 (SELECT count(*) FROM app.workflow_issue WHERE resolved_at IS NULL) exceptions,
 (SELECT count(*) FROM app.credit_request WHERE status='PENDING') credit_pending,
 (SELECT count(*) FROM app.data_request WHERE status='OPEN') dr_open,
 (SELECT count(*) FROM app.role_configuration WHERE status IN ('SANDBOX','DRAFT')) cfg_sandbox`;
 const jobs=await sql<{status:string;n:number}[]>`SELECT status,count(*)::int n FROM app.job GROUP BY status ORDER BY status`;
 return {counts,jobs};
}
export const metricDefinitions=[
 ['candidates','Candidates','Total registered','users','blue','/ops/candidates'],
 ['assessed','Assessed','Completed assessments','shield','green','/ops/candidates'],
 ['applications','Applications','Confirmed interest','file','amber','/ops/applications'],
 ['closed_jobs','Closed jobs','Closed, filled or expired','job','purple','/ops/jobs'],
 ['suggestions','Suggestions','Eligible recommendations','spark','rose','/ops/matches'],
 ['awaiting_assessment','Awaiting assessment','Candidates to follow up','clock','cyan','/ops/candidates'],
 ['awaiting_interest','Awaiting interest','Unconfirmed applications','heart','pink','/ops/applications'],
 ['referrals','Referrals','Partner referrals','link','blue','/ops/attribution'],
 ['unlocks','Unlocks','Confirmed candidate unlocks','lock','green','/ops/applications'],
 ['referral_paise','Referral rewards','Accrued, excluding reversals','file','purple','/ops/reports'],
];
