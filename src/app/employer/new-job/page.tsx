import Link from 'next/link';
import { sql } from '@/lib/db';
import { Clause } from '../../ui';
import { NewJobForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NewJobPage() {
  const employerId = 'EMP-001';

  const locations = await sql<{ id: string; name: string; locality_key: string }[]>`
    SELECT id, name, locality_key FROM app.employer_location
     WHERE employer_id = ${employerId} AND status = 'ACTIVE' ORDER BY id
  `;

  /**
   * JOB-08/09 — the form is rendered from the published role template. Only
   * configurations that are actually published can be selected; the sandbox
   * retail role deliberately does not appear here until it is published.
   */
  const configs = await sql<{
    id: string; role_family_key: string; industry_key: string; version: string;
    job_attributes: { key: string; required: boolean }[];
    critical_skills: string[]; assessment_threshold: number | null;
  }[]>`
    SELECT id, role_family_key, industry_key, version, job_attributes,
           critical_skills, assessment_threshold
      FROM app.role_configuration
     WHERE status = 'PUBLISHED' ORDER BY industry_key, role_family_key
  `;

  const attrKeys = [...new Set(configs.flatMap((c) => c.job_attributes.map((a) => a.key)))];
  const attrDefs = attrKeys.length
    ? await sql<{ key: string; display_name: string; data_type: string; allowed_values: string[] }[]>`
        SELECT key, display_name, data_type, allowed_values
          FROM app.attribute_definition WHERE key = ANY(${attrKeys})
      `
    : [];

  return (
    <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>Post a job</h1>
            <div className="sub">
              The form is rendered from the published role configuration, not hardcoded
              {' '}<Clause>JOB-01 / 02 / 08 / 09</Clause>
            </div>
          </div>
          <Link className="btn" href="/employer">← Employer</Link>
        </div>
      </div>
      {locations.length === 0
        ? <div className="note bad">This employer has no active locations. Add one before posting a job.</div>
        : <NewJobForm employerId={employerId} locations={locations} configs={configs} attrDefs={attrDefs} />}
    </main>
  );
}
