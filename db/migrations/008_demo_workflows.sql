ALTER TABLE app.job ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN preferred_skills text NOT NULL DEFAULT '', ADD COLUMN work_mode text NOT NULL DEFAULT 'ONSITE', ADD COLUMN qualification text NOT NULL DEFAULT '';
ALTER TABLE app.candidate ADD COLUMN education text NOT NULL DEFAULT '';
CREATE TABLE app.job_suggestion(candidate_id text REFERENCES app.candidate(id),job_id text REFERENCES app.job(id),score numeric,explanation jsonb NOT NULL DEFAULT '[]',gaps jsonb NOT NULL DEFAULT '[]',eligible boolean NOT NULL DEFAULT false,hidden boolean NOT NULL DEFAULT false,reason text,updated_at timestamptz NOT NULL,PRIMARY KEY(candidate_id,job_id));
CREATE TABLE app.candidate_reminder(candidate_id text REFERENCES app.candidate(id),job_id text REFERENCES app.job(id),due_at timestamptz NOT NULL,sent_at timestamptz,PRIMARY KEY(candidate_id,job_id));
CREATE TABLE app.credit_request(id text PRIMARY KEY,employer_id text REFERENCES app.employer_organisation(id),job_id text REFERENCES app.job(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),reason text NOT NULL,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),decision_reason text,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz);
CREATE TABLE app.workflow_issue(id text PRIMARY KEY,candidate_id text REFERENCES app.candidate(id),kind text NOT NULL,detail text NOT NULL,resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE app.application DROP CONSTRAINT application_status_check;
ALTER TABLE app.application ADD CONSTRAINT application_status_check CHECK(status IN ('INTERESTED','APPLIED','ELIGIBILITY_CHECK','CANDIDATE_RECONFIRMED','QUALIFIED','NOT_QUALIFIED','PREVIEWED','UNLOCKED','SHORTLISTED','CONTACTED','INTERVIEW','REJECTED','SELECTED','JOINED','WITHDRAWN'));
ALTER TABLE app.optional_outcome_event DROP CONSTRAINT optional_outcome_event_outcome_check;
ALTER TABLE app.optional_outcome_event ADD CONSTRAINT optional_outcome_event_outcome_check CHECK(outcome IN ('SHORTLISTED','CONTACTED','INTERVIEW_SCHEDULED','INTERVIEW_ATTENDED','REJECTED','SELECTED','JOINED'));
