import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { creditBalance, reconcileEntitlement } from '@/modules/commercial';
import { activeCommercialPolicy } from '@/modules/configuration';
import { Clause, Money, Stat } from '../../ui';
import { SubNav, EMPLOYER_TABS } from '../../subnav';
import { BuyCredits } from './billing-client';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const employerId = 'EMP-001';
  const policy = await activeCommercialPolicy();

  const ents = await sql<{
    id: string; job_id: string; title: string; posting_fee_paise: string;
    credits_included: number; max_distinct_unlocks: number;
    starts_at: Date; ends_at: Date; credit_expiry_at: Date;
  }[]>`
    SELECT e.*, j.title FROM app.posting_entitlement e JOIN app.job j ON j.id=e.job_id
     WHERE j.employer_id = ${employerId} ORDER BY e.id`;

  const recon = new Map<string, Awaited<ReturnType<typeof reconcileEntitlement>>>();
  const bal = new Map<string, Awaited<ReturnType<typeof creditBalance>>>();
  for (const e of ents) {
    recon.set(e.id, await reconcileEntitlement(e.id));
    bal.set(e.id, await creditBalance(e.id));
  }

  const ledger = await sql<{
    id: string; entitlement_id: string; entry_type: string; credit_delta: number;
    amount_paise: string; unlock_id: string | null; linked_entry_id: string | null;
    note: string | null; created_at: Date;
  }[]>`
    SELECT c.* FROM app.credit_ledger c
      JOIN app.posting_entitlement e ON e.id = c.entitlement_id
      JOIN app.job j ON j.id = e.job_id
     WHERE j.employer_id = ${employerId} ORDER BY c.created_at, c.id`;

  const spend = ents.reduce((a, e) => a + Number(e.posting_fee_paise), 0)
    + ledger.filter((l) => l.entry_type === 'PURCHASE').reduce((a, l) => a + Number(l.amount_paise), 0);
  const totalAvailable = [...bal.values()].reduce((a, b) => a + b.available, 0);
  const totalUnlocks = [...bal.values()].reduce((a, b) => a + b.consumed - b.restored, 0);

  return (
    <>
      <SubNav tabs={EMPLOYER_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Billing &amp; credits</h1>
          <div className="sub">
            A posting entitlement is ₹2,500 for 30 days including {policy.includedUnlockCredits} unlock
            credits; further credits are <Money paise={policy.additionalCreditPaise} /> each
            {' '}<Clause>§9.2 · §9.3</Clause>
          </div>
        </div>

        <div className="grid g3 mb">
          <Stat k="Committed spend" v={<Money paise={spend} />} d={`${ents.length} postings`} />
          <Stat k="Credits available" v={totalAvailable} d="across all live postings" />
          <Stat k="Effective cost per unlock" v={totalUnlocks > 0 ? <Money paise={Math.round(spend / totalUnlocks)} /> : '—'}
                d={`${totalUnlocks} net unlocks`} />
        </div>

        <div className="card">
          <div className="card-head"><h2>Entitlements</h2><Clause>JOB-06 / JOB-07</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr>
                <th>Entitlement</th><th>Job</th><th className="num">Fee</th><th className="num">Included</th>
                <th className="num">Purchased</th><th className="num">Used</th><th className="num">Available</th>
                <th>Credits expire</th><th className="right">Buy</th>
              </tr></thead>
              <tbody>
                {ents.map((e) => {
                  const b = bal.get(e.id)!;
                  return (
                    <tr key={e.id}>
                      <td className="id">{e.id}</td>
                      <td className="small">{e.title}<div className="id">{e.job_id}</div></td>
                      <td className="num"><Money paise={e.posting_fee_paise} /></td>
                      <td className="num">{b.granted}</td>
                      <td className="num">{b.purchased}</td>
                      <td className="num">{b.consumed}<div className="small muted">+{b.restored} back</div></td>
                      <td className="num"><strong>{b.available}</strong></td>
                      <td className="small muted">{fmtDateTime(e.credit_expiry_at)}</td>
                      <td className="right"><BuyCredits jobId={e.job_id} pricePaise={policy.additionalCreditPaise} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div></div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Reconciliation</h2><Clause>§25</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Entitlement</th><th className="num">Opening</th><th className="num">Granted</th><th className="num">Purchased</th><th className="num">Unlocks</th><th className="num">Adjustments</th><th className="num">Closing</th><th>Check</th></tr></thead>
              <tbody>
                {[...recon.entries()].map(([id, r]) => (
                  <tr key={id}>
                    <td className="id">{id}</td>
                    <td className="num">{r.opening}</td>
                    <td className="num">+{r.granted}</td>
                    <td className="num">+{r.purchased}</td>
                    <td className="num">−{r.unlocks}</td>
                    <td className="num">{r.adjustments >= 0 ? '+' : ''}{r.adjustments}</td>
                    <td className="num"><strong>{r.closing}</strong></td>
                    <td>{r.balances && r.unlocksMatchLedger
                      ? <span className="pill p-ok">balanced</span>
                      : <span className="pill p-bad">mismatch</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note small" style={{ margin: 14 }}>
            opening + credits − unlocks ± adjustments = closing, checked on every render.
          </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Credit ledger</h2><span className="small muted">append-only</span></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Entry</th><th>Entitlement</th><th>Type</th><th className="num">Δ credits</th><th className="num">Amount</th><th>Links</th><th>Note</th><th>When</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="id">{l.id}</td>
                    <td className="id">{l.entitlement_id}</td>
                    <td className="small">{l.entry_type.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="num" style={{ color: l.credit_delta < 0 ? 'var(--bad)' : undefined }}>
                      {l.credit_delta > 0 ? '+' : ''}{l.credit_delta}</td>
                    <td className="num"><Money paise={l.amount_paise} /></td>
                    <td className="id">{l.linked_entry_id ?? '—'}</td>
                    <td className="small muted">{l.note}</td>
                    <td className="small muted">{fmtDateTime(l.created_at)}</td>
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
