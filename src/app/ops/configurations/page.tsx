import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { ConfigPanel, SandboxEditor } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function ConfigurationsPage() {
  const viewer=await scopePage('ops');
  const configs = await sql<{
    id: string; industry_key: string; role_family_key: string; version: string; status: string;
    assessment_threshold: number | null; scoring_weights: Record<string, number>;
  }[]>`SELECT * FROM app.role_configuration ORDER BY id`;

  const releases = await sql<{
    id: string; package_name: string; version: string; geography: string | null;
    cohort_flag: string | null; status: string;
  }[]>`SELECT id, package_name, version, geography, cohort_flag, status
         FROM app.configuration_release ORDER BY id`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Industry &amp; role configuration</h1>
          <div className="sub">
            Fields, skills, assessments, thresholds and weights live here as data. Adding an industry
            is a configuration act, not a deployment. <Clause>§2.1 · §8.4A</Clause>
          </div>
        </div>
        <a className="btn" href="/ops/manage">Add role, field or assessment</a><ConfigPanel configs={configs} canAdmin={viewer.role==='ADMIN'} />
        {viewer.role==='ADMIN'&&<SandboxEditor configs={configs.filter((c) => c.status === 'SANDBOX' || c.status === 'DRAFT')} />}
        <div className="card">
          <div className="card-head"><h2>Release packages</h2><Clause>CFG-06/07</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Package</th><th>Version</th><th>Geography</th><th>Cohort</th><th>Status</th></tr></thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id}>
                    <td><span className="id">{r.id}</span><br />{r.package_name}</td>
                    <td className="num">{r.version}</td>
                    <td className="small">{r.geography ?? '—'}</td>
                    <td className="small">{r.cohort_flag ?? '—'}</td>
                    <td><span className="pill p-mute">{r.status.toLowerCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      </main>
    </>
  );
}
