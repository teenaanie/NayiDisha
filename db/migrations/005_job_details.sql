SET search_path TO app, public;
INSERT INTO attribute_definition(key,scope,data_type,display_name,created_at) VALUES
('joining_date','JOB','TEXT','Expected joining date',now()),('incentive_conditions','JOB','TEXT','Incentive conditions',now()),('overtime','JOB','TEXT','Overtime and pay',now()),('benefits','JOB','TEXT','Benefits',now()),('employment_type','JOB','TEXT','Employment type',now()),('safety','JOB','TEXT','Workplace and travel safety',now()) ON CONFLICT(key) DO NOTHING;
ALTER TABLE reward_ledger ADD COLUMN IF NOT EXISTS status_before_suspension text;
