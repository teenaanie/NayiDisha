'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '../api';

export function ImportDraft() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <form onSubmit={async (e) => { e.preventDefault(); setError('');
    try { const r = await api('POST', 'admin/scenarios', text); router.push(`/roleplay/admin/drafts/${r.data.draft_id}`); }
    catch (x) { setError(x instanceof ApiFailure ? x.message : 'Import failed.'); } }}>
    <label className="field">Paste a bundle, or choose a .json file
      <input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
    </label>
    <textarea className="rp-json" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"schema_version":"1.0", ...}' aria-label="Bundle JSON" />
    <button className="btn btn-primary" disabled={!text.trim()}>Create draft</button>
    {error && <p role="alert">{error}</p>}
    <p className="small muted">Duplicate keys, unknown fields and broken references are rejected with field paths. Tenant and lifecycle fields come from your account, never from the file.</p>
  </form>;
}

export function VersionActions({ versionId, scenarioId, version, canAuthor, canReview, retired }: { versionId: string; scenarioId: string; version: string; canAuthor: boolean; canReview: boolean; retired: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  return <div className="btnrow">
    <a className="btn btn-sm" href={`/v1/admin/versions/${versionId}/export`} target="_blank" rel="noreferrer">Export JSON</a>
    {canAuthor && <button className="btn btn-sm" onClick={async () => { try { const r = await api('POST', `admin/versions/${versionId}/draft`); router.push(`/roleplay/admin/drafts/${r.data.draft_id}`); } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Failed'); } }}>Edit as new draft</button>}
    {canReview && !retired && <button className="btn btn-sm" onClick={async () => { const reason = prompt(`Retire ${scenarioId} ${version}? New sessions will be blocked; running ones finish. Reason:`); if (!reason) return; try { await api('POST', `admin/scenarios/${scenarioId}/retire`, { version, reason }); router.refresh(); } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Failed'); } }}>Retire</button>}
    {error && <span role="alert" className="small">{error}</span>}
  </div>;
}
