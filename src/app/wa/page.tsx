import { sql } from '@/lib/db';
import { Clause } from '../ui';
import { Simulator } from './simulator';

export const dynamic = 'force-dynamic';

export default async function WaPage({
  searchParams,
}: { searchParams: Promise<{ code?: string; cand?: string }> }) {
  const { code, cand } = await searchParams;

  const localities = await sql<{ key: string; display_name: string }[]>`
    SELECT key, display_name FROM app.locality ORDER BY display_name`;

  const jobs = await sql<{
    id: string; title: string; brand: string; loc: string; locality_key: string;
    fixed_pay_paise: string; variable_max_paise: string; shift: string;
  }[]>`
    SELECT j.id, j.title, e.brand_name AS brand, l.name AS loc, l.locality_key,
           j.fixed_pay_paise, j.variable_max_paise, j.shift
      FROM app.job j
      JOIN app.employer_organisation e ON e.id=j.employer_id
      JOIN app.employer_location l ON l.id=j.location_id
     WHERE j.status='LIVE' ORDER BY j.id`;

  const [assessment] = await sql<{
    id: string; questions: { id: string; prompt: string; options: string[]; answer: string; marks: number }[];
  }[]>`SELECT id, questions FROM app.assessment_template WHERE id='AST-BFSI-RE-1'`;

  let site: { code: string; partnerName: string; siteId: string; partnerId: string; valid: boolean } | null = null;
  if (code) {
    const [row] = await sql<{
      id: string; partner_id: string; partner_code: string; name: string; s_status: string; p_status: string;
    }[]>`
      SELECT s.id, s.partner_id, s.partner_code, p.name, s.status AS s_status, p.status AS p_status
        FROM app.partner_site s JOIN app.partner p ON p.id = s.partner_id
       WHERE s.qr_token=${code} OR s.partner_code=${code}`;
    if (row) {
      site = {
        code, partnerName: row.name, siteId: row.id, partnerId: row.partner_id,
        valid: row.s_status === 'ACTIVE' && row.p_status === 'VERIFIED',
      };
    }
  }

  const existing = cand
    ? (await sql<{ id: string; name: string | null; status: string }[]>`
        SELECT id, name, status FROM app.candidate WHERE id=${cand}`)[0] ?? null
    : null;

  const history = existing
    ? await sql<{ id: string; direction: string; body: string; category: string | null }[]>`
        SELECT id, direction, body, category FROM app.message_log
         WHERE candidate_id=${existing.id} ORDER BY created_at, id`
    : [];

  return (
    <main className="page">
      <div className="page-head">
        <h1>Candidate journey — WhatsApp simulator</h1>
        <div className="sub">
          The simulator and the production Cloud API adapter emit the same normalised conversation
          events. Nothing here reaches a real number. <Clause>§10.1 · §21.2 · §25</Clause>
        </div>
      </div>

      <div className="split">
        <div className="wa-shell">
          <Simulator
            site={site}
            localities={localities}
            jobs={jobs}
            assessment={assessment}
            existing={existing}
            history={history}
          />
        </div>

        <div>
          <div className="card">
            <div className="card-head"><h3>Entry point</h3><Clause>§8.3</Clause></div>
            <div className="card-body">
              {site ? (
                <>
                  <p className="small">
                    Arrived through <strong>{site.partnerName}</strong> ({site.code}).
                  </p>
                  {!site.valid && (
                    <div className="note warn small">
                      That site is suspended or revoked. Registration still works — the candidate is never
                      punished for a partner problem — but attribution is held for operations review
                      rather than silently credited. <Clause>§15</Clause>
                    </div>
                  )}
                </>
              ) : (
                <p className="small muted">
                  Direct entry, no partner code. Open a partner&apos;s QR from the Partner console to
                  arrive with attribution, or type a code in step 1.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Message log</h3><Clause>§16.2</Clause></div>
            <div className="card-body tight">
              {history.length === 0 ? <div className="empty">No messages yet.</div> : (
                <div className="tblwrap">
                  <table>
                    <thead><tr><th>Dir</th><th>Category</th><th className="num">Cost model</th></tr></thead>
                    <tbody>
                      {history.map((m) => (
                        <tr key={m.id}>
                          <td className="small">{m.direction === 'INBOUND' ? '← in' : '→ out'}</td>
                          <td className="small">{m.category?.toLowerCase() ?? 'inbound'}</td>
                          <td className="num small muted">
                            {m.category === 'MARKETING' ? '₹0.86' : m.category === 'SERVICE' || !m.category ? 'free' : '₹0.12'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="note small" style={{ margin: 14 }}>
                Registration happens inside a candidate-initiated service window, where messages are
                free. Only proactive job alerts fall into the paid marketing category.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
