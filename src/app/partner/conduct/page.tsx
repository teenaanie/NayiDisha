import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { CONDUCT_RULES, CONDUCT_VERSION } from '@/modules/lifecycle';
import { Clause } from '../../ui';
import { SubNav, PARTNER_TABS } from '../../subnav';
import { AcceptConduct } from '../partner-client';

export const dynamic = 'force-dynamic';

export default async function ConductPage({
  searchParams,
}: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const partnerId = p ?? 'PAR-001';

  const [partner] = await sql<{
    id: string; name: string; conduct_accepted_at: Date | null; conduct_version: string | null;
  }[]>`SELECT id, name, conduct_accepted_at, conduct_version FROM app.partner WHERE id=${partnerId}`;

  return (
    <>
      <SubNav tabs={PARTNER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Conduct rules</h1>
          <div className="sub">
            Accepted per partner, with the version recorded, before any reward is paid
            {' '}<Clause>PART-07</Clause>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 720 }}>
          <div className="card-head">
            <h2>{partner.name}</h2>
            <span className="clause">{CONDUCT_VERSION}</span>
          </div>
          <div className="card-body">
            <ol style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CONDUCT_RULES.map((r) => (
                <li key={r} style={{ fontSize: '.95rem', lineHeight: 1.5 }}>{r}</li>
              ))}
            </ol>

            <div className="note warn mt">
              Paying someone per worker recruited is structurally the informal labour-broker model.
              The moment a partner asks a worker for money, the platform carries it. That is why the
              first rule is a fee ban, why the sticker prints a complaint number, and why every
              placed worker is asked one question: <em>did anyone ask you for money?</em>
            </div>

            <div className="mt">
              {partner.conduct_accepted_at ? (
                <div className="note">
                  Accepted {fmtDateTime(partner.conduct_accepted_at)} · version{' '}
                  <code>{partner.conduct_version}</code>
                </div>
              ) : (
                <AcceptConduct partnerId={partnerId} />
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
