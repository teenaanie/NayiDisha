import {scopePage} from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { Clause } from '../../ui';
import { SubNav, OPS_TABS } from '../../subnav';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: { searchParams: Promise<{ role?: string }> }) {
  const viewer=await scopePage('ops');
  const { role } = await searchParams;

  const roles = await sql<{ actor_role: string; n: string }[]>`
    SELECT actor_role, COUNT(*)::text n FROM (SELECT id::text,actor,role AS actor_role,action AS event,'record'::text AS entity_type,entity_id,NULL::text AS reason,detail,created_at FROM app.action_audit UNION ALL SELECT id,actor,actor_role,event,entity_type,entity_id,reason,detail,created_at FROM app.audit_log) audit_history GROUP BY actor_role ORDER BY actor_role`;

  const rows = role
    ? await sql<{ id: string; actor: string; actor_role: string; event: string; entity_type: string | null; entity_id: string | null; reason: string | null; detail: Record<string, unknown>; created_at: Date }[]>`
        SELECT * FROM (SELECT id::text,actor,role AS actor_role,action AS event,'record'::text AS entity_type,entity_id,NULL::text AS reason,detail,created_at FROM app.action_audit UNION ALL SELECT id,actor,actor_role,event,entity_type,entity_id,reason,detail,created_at FROM app.audit_log) audit_history WHERE actor_role = ${role} ORDER BY created_at DESC, id DESC LIMIT 200`
    : await sql<{ id: string; actor: string; actor_role: string; event: string; entity_type: string | null; entity_id: string | null; reason: string | null; detail: Record<string, unknown>; created_at: Date }[]>`
        SELECT * FROM (SELECT id::text,actor,role AS actor_role,action AS event,'record'::text AS entity_type,entity_id,NULL::text AS reason,detail,created_at FROM app.action_audit UNION ALL SELECT id,actor,actor_role,event,entity_type,entity_id,reason,detail,created_at FROM app.audit_log) audit_history ORDER BY created_at DESC, id DESC LIMIT 200`;

  return (
    <>
      <SubNav tabs={OPS_TABS} />
      <main className="page">
        <div className="page-head">
          <h1>Audit explorer</h1>
          <div className="sub">
            Material employer, partner, match, document, milestone and payout actions, each with
            actor, time and reason <Clause>§14 Audit</Clause>
          </div>
        </div>

        <div className="btnrow mb">
          <a className={`btn btn-sm ${!role ? 'btn-primary' : ''}`} href="/ops/audit">All ({rows.length})</a>
          {roles.map((r) => (
            <a key={r.actor_role} className={`btn btn-sm ${role === r.actor_role ? 'btn-primary' : ''}`}
               href={`/ops/audit?role=${r.actor_role}`}>
              {r.actor_role.toLowerCase()} ({r.n})
            </a>
          ))}
        </div>

        <div className="card"><div className="card-body tight"><div className="tblwrap">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Entity</th><th>Reason</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="small muted">{fmtDateTime(a.created_at)}</td>
                  <td className="small">{a.actor}<div className="muted">{a.actor_role.toLowerCase()}</div></td>
                  <td className="small"><strong>{a.event.replace(/_/g, ' ').toLowerCase()}</strong></td>
                  <td className="id">{a.entity_id}<div className="muted small">{a.entity_type}</div></td>
                  <td className="small muted">{a.reason}</td>
                  <td className="small mono" style={{ fontSize: '.7rem', maxWidth: 260, overflow: 'hidden' }}>
                    {a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail).slice(0, 160) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div></div>
      </main>
    </>
  );
}
