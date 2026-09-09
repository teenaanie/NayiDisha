import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { Clause, Money, StatusPill } from '../../ui';
import { SubNav, FINANCE_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const viewer=await scopePage('finance');
  const rows = await sql<{
    id: string; partner_id: string; entry_type: string; amount_paise: string; status: string;
    unlock_id: string | null; linked_entry_id: string | null; payout_id: string | null;
    fy_label: string; note: string | null; created_at: Date;
  }[]>`SELECT * FROM app.reward_ledger ORDER BY created_at, id`;

  const net = rows.reduce((a, r) => a + Number(r.amount_paise), 0);
  const byFy = new Map<string, number>();
  for (const r of rows) byFy.set(r.fy_label, (byFy.get(r.fy_label) ?? 0) + Number(r.amount_paise));

  return (
    <>
      <SubNav tabs={FINANCE_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Reward ledger</h1>
          <div className="sub">
            Append-only. A correction is a new row linked to the one it corrects; nothing is ever
            edited or deleted. <Clause>REF-08</Clause>
          </div>
        </div>

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr>
              <th>Entry</th><th>Partner</th><th>Type</th><th>Unlock</th><th>Corrects</th>
              <th>Payout</th><th className="num">Amount</th><th>Status</th><th>FY</th><th>When</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="id">{r.id}</td>
                  <td className="id">{r.partner_id}</td>
                  <td className="small">{r.entry_type.toLowerCase()}
                    {r.note && <div className="muted">{r.note}</div>}</td>
                  <td className="id">{r.unlock_id ?? '—'}</td>
                  <td className="id">{r.linked_entry_id ?? '—'}</td>
                  <td className="id">{r.payout_id ?? '—'}</td>
                  <td className="num" style={{ color: Number(r.amount_paise) < 0 ? 'var(--bad)' : undefined }}>
                    <Money paise={r.amount_paise} /></td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="small mono">{r.fy_label}</td>
                  <td className="small muted">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={6}><strong>Net position</strong></td>
                <td className="num"><strong><Money paise={net} /></strong></td>
                <td colSpan={3} className="small muted">reconciles to the payout provider</td>
              </tr>
            </tbody>
          </table>
        </div></div></div>

        <div className="card">
          <div className="card-head"><h2>By financial year</h2><Clause>s.194H</Clause></div>
          <div className="card-body tight"><div className="tblwrap">
            <table>
              <thead><tr><th>Financial year</th><th className="num">Net</th></tr></thead>
              <tbody>{[...byFy.entries()].map(([fy, v]) => (
                <tr key={fy}><td className="mono">{fy}</td><td className="num"><Money paise={v} /></td></tr>
              ))}</tbody>
            </table>
          </div></div>
        </div>
      </main>
    </>
  );
}
