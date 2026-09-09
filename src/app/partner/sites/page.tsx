import { sql } from '@/lib/db';
import { Clause, StatusPill, QrBlock } from '../../ui';
import { SubNav, PARTNER_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function SitesPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const partnerId = p ?? 'PAR-001';

  const sites = await sql<{
    id: string; locality_key: string; partner_code: string; qr_token: string;
    status: string; scans: string;
  }[]>`
    SELECT s.*, (SELECT COUNT(*)::text FROM app.attribution a WHERE a.partner_site_id=s.id) AS scans
      FROM app.partner_site s WHERE s.partner_id=${partnerId} ORDER BY s.id`;

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>QR sites</h1>
          <div className="sub">
            Printed once, resolved server-side. The code beneath the square is the fallback for a
            failed scan. <Clause>PART-05 / PART-06</Clause>
          </div>
        </div>

        <div className="grid g3">
          {sites.map((s) => (
            <div className="card" key={s.id}>
              <div className="card-head">
                <h3>{s.locality_key.replace(/_/g, ' ')}</h3>
                <StatusPill status={s.status} />
              </div>
              <div className="card-body">
                <div className="qr-card">
                  <div style={{ fontSize: '.66rem', letterSpacing: '.16em', textTransform: 'uppercase', opacity: .85 }}>
                    नोकरी · JOBS
                  </div>
                  <div style={{ fontSize: '1.12rem', fontWeight: 800, lineHeight: 1.15, margin: '7px 0 10px' }}>
                    पास में बैंक की नौकरी?
                  </div>
                  <QrBlock seed={s.qr_token} />
                  <div className="code">{s.partner_code}</div>
                  <div className="free">
                    यह सेवा नौकरी ढूँढने वालों के लिए मुफ़्त है<br />
                    Free for job seekers · complaint 1800-XXX-XXXX
                  </div>
                </div>
                <table className="mt">
                  <tbody className="small">
                    <tr><td>Site</td><td className="right id">{s.id}</td></tr>
                    <tr><td>Registrations</td><td className="right num">{s.scans}</td></tr>
                    <tr><td>Scan target</td><td className="right id" style={{ fontSize: '.7rem' }}>/j/{s.qr_token}</td></tr>
                  </tbody>
                </table>
                <div className="btnrow mt">
                  <a className="btn btn-sm btn-primary" href={`/j/${s.qr_token}`}>Open the candidate journey</a>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="note mt">
          The complaint number and the words &ldquo;free for job seekers&rdquo; are printed on the
          sticker itself. That is a safeguard, not decoration: it is what a worker looks at when
          somebody asks them for money.
        </div>
      </main>
    </>
  );
}
