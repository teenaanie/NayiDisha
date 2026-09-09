import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import {NavigationLink} from '../../navigation-link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { OpsActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function EmployersPage() {
  const viewer=await scopePage('ops');
  const employers = await sql<{
    id: string; legal_name: string; brand_name: string; gst_pan: string | null;
    billing_contact: string | null; status: string; status_reason: string | null;
    status_at: Date; jobs: string; locations: string; users: string;
  }[]>`
    SELECT e.*,
      (SELECT COUNT(*)::text FROM app.job j WHERE j.employer_id=e.id) AS jobs,
      (SELECT COUNT(*)::text FROM app.employer_location l WHERE l.employer_id=e.id) AS locations,
      (SELECT COUNT(*)::text FROM app.employer_user u WHERE u.employer_id=e.id) AS users
    FROM app.employer_organisation e ORDER BY e.id`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>Employers</h1>
              <div className="sub">
                Only verified direct employers may post jobs <Clause>OPS-EMP-01 / 04</Clause>
              </div>
            </div>
            <NavigationLink className="btn btn-primary" href="/ops/new-employer">+ Add employer</NavigationLink>
          </div>
        </div>
        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>ID</th><th>Employer</th><th>GST / PAN</th>
              <th className="num">Branches</th><th className="num">Users</th><th className="num">Jobs</th>
              <th>Status</th><th className="right">Action</th>
            </tr></thead>
            <tbody>
              {employers.map((e) => (
                <tr key={e.id}>
                  <td className="id">{e.id}</td>
                  <td><strong>{e.brand_name}</strong><div className="small muted">{e.legal_name}</div></td>
                  <td className="small mono">{e.gst_pan ?? '—'}</td>
                  <td className="num">{e.locations}</td>
                  <td className="num">{e.users}</td>
                  <td className="num">{e.jobs}</td>
                  <td><StatusPill status={e.status} />
                    {e.status_reason && <div className="small muted">{e.status_reason}</div>}
                    <div className="small muted">{fmtDateTime(e.status_at)}</div>
                  </td>
                  <td className="right"><div className="record-actions"><Link className="btn btn-sm" href={`/ops/employers/${e.id}/edit`} aria-label={`Edit ${e.brand_name}`}>Edit</Link><OpsActions kind="employer" id={e.id} status={e.status} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>
      </main>
    </>
  );
}
