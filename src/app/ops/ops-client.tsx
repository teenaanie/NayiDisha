'use client';
import { useState, useTransition } from 'react';
import {
  actApproveEmployer, actSuspendEmployer, actApproveJob, actSetPartnerStatus,
  actRotateQr, actResolveAttribution, actDecideReplacement,
  actPublishConfig, actValidateConfig, actUpdateSandboxWeights, actUpdateSandboxThreshold,
  actResolveDataRequest,
} from '../actions';
import { StatusPill } from '../ui';

export function OpsActions(props:{kind:string;id:string;status:string}){
 const [pending,start]=useTransition();const [message,setMessage]=useState('');
 const run=(fn:()=>Promise<unknown>)=>()=>start(async()=>{setMessage('');try{await fn();setMessage('Saved.');}catch(error){setMessage(error instanceof Error?error.message:'Unable to save. Please try again.');}});
 return <div><OpsButtons {...props} pending={pending} run={run}/><span role="status" aria-live="polite" className="small">{pending?'Saving…':message}</span></div>;
}
function OpsButtons({kind,id,status,pending,run}:{kind:string;id:string;status:string;pending:boolean;run:(fn:()=>Promise<unknown>)=>()=>void}){
  if (kind === 'employer') {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        {status !== 'VERIFIED' && (
          <button className="btn btn-sm btn-primary" disabled={pending}
                  onClick={run(() => actApproveEmployer(id))}>Approve</button>
        )}
        {status === 'VERIFIED' && (
          <button className="btn btn-sm" disabled={pending}
                  onClick={run(() => actSuspendEmployer(id, 'Operations suspension — demo'))}>Suspend</button>
        )}
      </div>
    );
  }
  if (kind === 'partner') {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        {status === 'VERIFIED'
          ? <button className="btn btn-sm" disabled={pending}
              onClick={run(() => actSetPartnerStatus(id, 'SUSPENDED', 'Suspected referral abuse — demo'))}>Suspend</button>
          : <button className="btn btn-sm btn-primary" disabled={pending}
              onClick={run(() => actSetPartnerStatus(id, 'VERIFIED', status === 'PENDING_REVIEW' ? 'Initial approval' : 'Reinstated after review'))}>{status === 'PENDING_REVIEW' ? 'Approve new partner' : 'Reinstate'}</button>}
      </div>
    );
  }
  if (kind === 'job') {
    return status === 'PENDING_APPROVAL'
      ? <button className="btn btn-sm btn-primary" disabled={pending} onClick={run(() => actApproveJob(id))}>Approve &amp; publish</button>
      : <span className="muted small">—</span>;
  }
  if (kind === 'attribution') {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-primary" disabled={pending}
                onClick={run(() => actResolveAttribution(id, 'ACTIVE'))}>Allow</button>
        <button className="btn btn-sm" disabled={pending}
                onClick={run(() => actResolveAttribution(id, 'VOID'))}>Void</button>
      </div>
    );
  }
  if (kind === 'replacement') {
    return (
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-primary" disabled={pending}
                onClick={run(() => actDecideReplacement(id, 'APPROVED'))}>Approve</button>
        <button className="btn btn-sm" disabled={pending}
                onClick={run(() => actDecideReplacement(id, 'REJECTED'))}>Reject</button>
      </div>
    );
  }
  if (kind === 'site') {
    return <button className="btn btn-sm" disabled={pending} onClick={run(() => actRotateQr(id))}>Rotate QR</button>;
  }
  return null;
}

interface Cfg {
  id: string; industry_key: string; role_family_key: string; version: string; status: string;
  assessment_threshold: number | null; scoring_weights: Record<string, number>;
}

export function ConfigPanel({ configs,canAdmin=true }: { configs: Cfg[];canAdmin?:boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Record<string, { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }>>({});

  return (
    <div className="card">
      <div className="card-head">
        <h2>Industry and role configuration</h2>{!canAdmin&&<p className="small">Administrator identity is required to validate and publish. Drafts can be edited in Manage &amp; catalogue.</p>}
        <span className="clause">§8.4A CFG-04/07/10</span>
      </div>
      <div className="card-body tight">
        <div className="tblwrap">
          <table>
            <thead>
              <tr><th>Config</th><th>Industry / role</th><th className="num">Threshold</th><th>Weights</th><th>Status</th><th className="right">Action</th></tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id}>
                  <td className="id">{c.id}<br /><span className="muted">v{c.version}</span></td>
                  <td className="small">{c.industry_key}<br /><span className="muted">{c.role_family_key.replace(/_/g, ' ').toLowerCase()}</span></td>
                  <td className="num">{c.assessment_threshold ?? '—'}</td>
                  <td className="small mono" style={{ fontSize: '.72rem' }}>
                    {Object.entries(c.scoring_weights).map(([k, v]) => `${k.slice(0, 4)}:${v}`).join(' ')}
                    <div className="muted">total {Object.values(c.scoring_weights).reduce((a, b) => a + b, 0)}</div>
                  </td>
                  <td><StatusPill status={c.status} /></td>
                  <td className="right">
                    <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" disabled={pending || !canAdmin} onClick={() => start(async () => {
                        const r = await actValidateConfig(c.id);
                        setResult((s) => ({ ...s, [c.id]: r }));
                      })}>Validate</button>
                      {c.status !== 'PUBLISHED' && (
                        <button className="btn btn-sm btn-primary" disabled={pending || !canAdmin}
                                onClick={() => start(async () => { await actPublishConfig(c.id); })}>Publish</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Object.entries(result).map(([id, r]) => (
          <div key={id} className={`note ${r.ok ? '' : 'warn'}`} style={{ margin: 14 }}>
            <strong>{id} — {r.ok ? 'passes all publication gates' : 'blocked'}</strong>
            <table style={{ marginTop: 8 }}>
              <tbody className="small">
                {r.checks.map((ch) => (
                  <tr key={ch.name}>
                    <td style={{ width: 22 }}>{ch.ok ? '✓' : '✗'}</td>
                    <td>{ch.name}</td>
                    <td className="muted mono" style={{ fontSize: '.72rem' }}>{ch.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * CFG-09 / §25 — change a sandbox role's scoring and threshold with no
 * deployment and no database migration. This is the framework proof.
 */
export function SandboxEditor({ configs }: { configs: Cfg[] }) {
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(configs[0]?.id ?? '');
  const cfg = configs.find((c) => c.id === sel);
  const [weights, setWeights] = useState<Record<string, number>>(cfg?.scoring_weights ?? {});
  const [threshold, setThreshold] = useState(cfg?.assessment_threshold ?? 55);
  const [msg, setMsg] = useState<string | null>(null);

  if (configs.length === 0) return null;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sandbox configuration editor</h2>
        <span className="clause">CFG-09 · framework proof</span>
      </div>
      <div className="card-body">
        <p className="small muted">
          Changing a field, weight or threshold here alters how the application scores candidates
          immediately — no code change, no schema migration, no deployment.
        </p>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="cfgsel">Sandbox configuration</label>
          <select id="cfgsel" value={sel} onChange={(e) => {
            const c = configs.find((x) => x.id === e.target.value);
            setSel(e.target.value);
            setWeights(c?.scoring_weights ?? {});
            setThreshold(c?.assessment_threshold ?? 55);
          }}>
            {configs.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.role_family_key}</option>)}
          </select>
        </div>

        <div className="grid g3">
          {Object.entries(weights).map(([k, v]) => (
            <div className="field" key={k}>
              <label htmlFor={`w-${k}`}>{k}</label>
              <input id={`w-${k}`} type="number" min={0} max={100} value={v}
                     onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="field">
            <label htmlFor="thr">Assessment threshold</label>
            <input id="thr" type="number" min={0} max={100} value={threshold}
                   onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
        </div>

        <div className="flexb mt">
          <span className={`small ${total === 100 ? 'muted' : ''}`} style={{ color: total === 100 ? undefined : 'var(--bad)' }}>
            Weights total <strong className="mono">{total}</strong> — publication requires exactly 100.
          </span>
          <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
            await actUpdateSandboxWeights(sel, weights);
            await actUpdateSandboxThreshold(sel, threshold);
            setMsg(`${sel} updated. Re-run matching on any job using this configuration to see the effect.`);
          })}>Save sandbox configuration</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}

export function DataRequestActions({id}:{id:string}){
 const [pending,start]=useTransition(),[field,setField]=useState('name'),[value,setValue]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState('');
 const run=(status:'ACTIONED'|'REFUSED')=>start(async()=>{try{await actResolveDataRequest(id,status,{field,value,reason});setMessage('Request processed.');}catch(e){setMessage(e instanceof Error?e.message:'Failed');}});
 return <div><select value={field} onChange={e=>setField(e.target.value)}><option value="name">Name correction</option><option value="locality_key">Locality correction</option></select><input aria-label="Corrected value" value={value} onChange={e=>setValue(e.target.value)} placeholder="Value (only for correction)"/><input aria-label="Decision reason" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Decision reason"/><button disabled={pending} onClick={()=>run('ACTIONED')}>Execute request</button><button disabled={pending} onClick={()=>run('REFUSED')}>Refuse with reason</button><p role="status">{message}</p></div>;
}
