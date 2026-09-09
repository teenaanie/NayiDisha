import Link from 'next/link';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { StatusPill, Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';
import { OpsActions } from '../ops-client';

export const dynamic = 'force-dynamic';

export default async function PartnersPage() {
  const partners = await sql<{
    id: string; name: string; partner_type: string; status: string; pan: string | null;
    payout_upi: string | null; capabilities: string[]; service_localities: string[];
    conduct_accepted_at: Date | null; conduct_version: string | null;
  }[]>`SELECT * FROM app.partner ORDER BY id`;

  const sites = await sql<{
    id: string; partner_id: string; locality_key: string; partner_code: string;
    qr_token: string; status: string;
  }[]>`SELECT * FROM app.partner_site ORDER BY partner_id, id`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <div className="flexb">
            <div>
              <h1>Sourcing partners</h1>
              <div className="sub">
                Verification, conduct rules, QR rotation and reward holds <Clause>§8.2 PART-01..10</Clause>
              </div>
            </div>
            <Link className="btn btn-primary" href="/ops/new-partner">+ Add partner</Link>
          </div>
        </div>

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>ID</th><th>Partner</th><th>Type</th><th>Capabilities</th>
              <th>PAN</th><th>Conduct</th><th>Status</th><th className="right">Action</th>
            </tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className="id">{p.id}</td>
                  <td><strong>{p.name}</strong>
                    <div className="small muted">{p.service_localities.join(', ').replace(/_/g, ' ')}</div></td>
                  <td className="small">{p.partner_type.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="small">
                    {p.capabilities.map((c) => <div key={c} className="tag">{c.split('/')[1]?.replace(/_/g, ' ').toLowerCase()}</div>)}
                  </td>
                  <td>{p.pan ? <span className="pill p-ok">yes</span> : <span className="pill p-warn">20% TDS</span>}</td>
                  <td>{p.conduct_accepted_at
                    ? <><span className="pill p-ok">accepted</span><div className="small muted">{fmtDateTime(p.conduct_accepted_at)}</div></>
                    : <span className="pill p-warn">not accepted</span>}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td className="right"><OpsActions kind="partner" id={p.id} status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>

        <div className="card">
          <div className="card-head"><h2>Sites and QR tokens</h2><Clause>PART-05 / PART-10</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Site</th><th>Partner</th><th>Locality</th><th>Code</th><th>QR token</th><th>Status</th><th className="right">Action</th></tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="id">{s.id}</td>
                    <td className="id">{s.partner_id}</td>
                    <td className="small">{s.locality_key.replace(/_/g, ' ')}</td>
                    <td className="id"><strong>{s.partner_code}</strong></td>
                    <td className="id small">{s.qr_token}</td>
                    <td><StatusPill status={s.status} /></td>
                    <td className="right"><OpsActions kind="site" id={s.id} status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note small" style={{ margin: 14 }}>
            Rotating a QR revokes the printed one immediately. The old sticker then fails safely and
            shows the official support route rather than a dead page.
          </div>
          </div>
        </div>
      </main>
    </>
  );
}
