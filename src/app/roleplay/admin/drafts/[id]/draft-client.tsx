'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, newKey, ApiFailure } from '../../../api';
import { Pill } from '../../../../ui';

type Issue = { path: string; message: string };
type Validation = { ok: boolean; errors: Issue[]; warnings: Issue[]; digest: string | null; diff: Record<string, unknown> | null; publication_notes: string[] };
type Draft = { id: string; scenario_id: string; revision: number; status: string; bundle: any; review_note: string | null; submitted_by: string | null };

/**
 * Builder steps (spec §21): metadata and brief as a form; persona, facts,
 * disclosure, rubric, risk, scoring, prompts and retry through the same JSON
 * the importer uses, with the same validator. Provenance is shown beside it.
 */
export function DraftEditor({ draft, initialValidation, canAuthor, canReview }: { draft: Draft; initialValidation: Validation; canAuthor: boolean; canReview: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(() => JSON.stringify(draft.bundle, null, 2));
  const [rev, setRev] = useState(draft.revision);
  const [v, setV] = useState<Validation>(initialValidation);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const editable = canAuthor && draft.status === 'draft';
  const parsed = useMemo(() => { try { return JSON.parse(text); } catch { return null; } }, [text]);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg(e instanceof ApiFailure ? `${e.message}${e.details?.errors ? ' — ' + (e.details.errors as Issue[]).map((x) => `${x.path}: ${x.message}`).slice(0, 5).join('; ') : ''}` : `${label} failed.`); } finally { setBusy(false); } };
  const save = () => run('Save', async () => {
    if (!parsed) throw new ApiFailure(400, 'INVALID_JSON', 'The JSON does not parse.', false, {});
    const r = await api('PATCH', `admin/scenarios/${draft.id}/draft`, { bundle: parsed, expected_revision: rev });
    setRev(r.data.revision); setMsg(`Saved revision ${r.data.revision}.`);
    setV((await api('POST', `admin/scenarios/${draft.id}/validate`)).data);
  });
  const setField = (path: string[], value: unknown) => {
    if (!parsed) return;
    const next = structuredClone(parsed); let o = next; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = value;
    setText(JSON.stringify(next, null, 2));
  };

  return <div>
    <div className="tags mb"><Pill tone={draft.status === 'in_review' ? 'warn' : 'mute'}>{draft.status.replace('_', ' ')}</Pill><Pill>revision {rev}</Pill>{v.ok ? <Pill tone="ok">valid</Pill> : <Pill tone="bad">{v.errors.length} errors</Pill>}{v.digest && <Pill>digest {v.digest.slice(0, 10)}</Pill>}</div>
    {draft.review_note && <div className="note warn mb">Reviewer note: {draft.review_note}</div>}
    {msg && <div role="status" className="note mb">{msg}</div>}

    <div className="grid g2 mb">
      <section className="card"><div className="card-head"><h2>1 · Metadata and learner brief</h2></div><div className="card-body">
        {parsed ? <>
          <label className="field">Title<input value={parsed.scenario?.title ?? ''} disabled={!editable} onChange={(e) => setField(['scenario', 'title'], e.target.value)} /></label>
          <label className="field">Version (semantic)<input value={parsed.scenario?.version ?? ''} disabled={!editable} onChange={(e) => setField(['scenario', 'version'], e.target.value)} /></label>
          <label className="field">Difficulty<input value={parsed.scenario?.difficulty ?? ''} disabled={!editable} onChange={(e) => setField(['scenario', 'difficulty'], e.target.value)} /></label>
          <label className="field">Learner brief<textarea rows={5} value={parsed.scenario?.learner_brief ?? ''} disabled={!editable} onChange={(e) => setField(['scenario', 'learner_brief'], e.target.value)} /></label>
          <label className="field">Opening line (customer)<textarea rows={3} value={parsed.conversation?.opening_text ?? ''} disabled={!editable} onChange={(e) => setField(['conversation', 'opening_text'], e.target.value)} /></label>
        </> : <p className="muted">Fix the JSON to use the form.</p>}
      </div></section>
      <section className="card"><div className="card-head"><h2>Validation</h2></div><div className="card-body">
        {v.errors.length ? <ul>{v.errors.map((e, i) => <li key={i}><code>{e.path}</code> {e.message}</li>)}</ul> : <p>No errors.</p>}
        {v.warnings.length > 0 && <><h3>Warnings</h3><ul className="small">{v.warnings.map((e, i) => <li key={i}><code>{e.path}</code> {e.message}</li>)}</ul></>}
        {v.publication_notes.length > 0 && <><h3>Reviewer must acknowledge</h3><ul className="small">{v.publication_notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
        {v.diff && <><h3>Change from the latest published version</h3><pre>{JSON.stringify(v.diff, null, 1)}</pre></>}
      </div></section>
    </div>

    {parsed && <section className="card mb"><div className="card-head"><h2>2–3 · Persona and facts</h2><span className="small muted">Known facts are server-side truth; unknown facts stay null and get the unknown reply</span></div><div className="card-body tight"><div className="tblwrap"><table>
      <thead><tr><th>Fact</th><th>Type</th><th>Knowledge</th><th>Value</th><th>Released on</th><th>Source</th></tr></thead>
      <tbody>{(parsed.facts ?? []).map((f: any) => <tr key={f.id}><td className="mono small">{f.id}</td><td className="small">{f.type}</td><td>{f.knowledge === 'known' ? <Pill tone="ok">known</Pill> : <Pill>unknown</Pill>}</td>
        <td className="small">{f.value === null ? <em>null (not invented)</em> : typeof f.value === 'object' ? JSON.stringify(f.value) : f.value}</td><td className="small">{(f.release_intents ?? []).join(', ')}</td><td className="small">{f.source_ref ?? '—'}</td></tr>)}</tbody>
    </table></div></div></section>}

    {parsed && <section className="card mb"><div className="card-head"><h2>Provenance</h2><span className="small muted">[S] source · [R] recommendation · [U] unspecified</span></div><div className="card-body tight"><div className="tblwrap"><table>
      <thead><tr><th>Path</th><th>Basis</th><th>Note</th></tr></thead>
      <tbody>{(parsed.provenance ?? []).map((p: any, i: number) => <tr key={i}><td className="mono small">{p.path}</td><td><Pill tone={p.basis === 'source' ? 'ok' : p.basis === 'unspecified' ? 'warn' : 'info'}>{p.basis === 'source' ? 'S' : p.basis === 'unspecified' ? 'U' : 'R'} {p.source_ref ?? ''}</Pill></td><td className="small">{p.note}</td></tr>)}</tbody>
    </table></div></div></section>}

    <section className="card mb"><div className="card-head"><h2>4–8 · Full bundle (disclosure rules, rubric, risk policy, scoring, prompts, retry)</h2></div><div className="card-body">
      <textarea className="rp-json" value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} aria-label="Bundle JSON" spellCheck={false} />
      {!parsed && <p role="alert">JSON does not parse.</p>}
    </div></section>

    <section className="card mb"><div className="card-head"><h2>9–10 · Preview, review and publish</h2></div><div className="card-body">
      <div className="btnrow mb">
        {editable && <button className="btn" disabled={busy} onClick={save}>Save draft</button>}
        <button className="btn" disabled={busy} onClick={() => run('Validate', async () => setV((await api('POST', `admin/scenarios/${draft.id}/validate`)).data))}>Validate</button>
        <button className="btn" disabled={busy || !v.ok} onClick={() => run('Preview', async () => { const r = await api('POST', `admin/scenarios/${draft.id}/preview`); router.push(`/roleplay/s/${r.data.session.session_id}`); })}>Preview as learner (test session)</button>
        {editable && <button className="btn btn-primary" disabled={busy || !v.ok} onClick={() => run('Submit', async () => { await api('POST', `admin/scenarios/${draft.id}/submit`, { expected_revision: rev }); router.refresh(); })}>Submit for review</button>}
      </div>
      {canReview && draft.status === 'in_review' && <div>
        <label className="field">Review note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have read the notes above (recommended anchors, knowledge-pack status, unknown facts) and approve publication.</label>
        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={busy || !ack || !v.ok} onClick={() => run('Publish', async () => { const r = await api('POST', `admin/scenarios/${draft.id}/publish`, { expected_revision: rev, review_note: note, acknowledged: ack }, { idempotencyKey: newKey() }); setMsg(`Published ${r.data.scenario_id} ${r.data.version}.`); router.push('/roleplay/admin'); })}>Publish immutable version</button>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => run('Reject', async () => { await api('POST', `admin/scenarios/${draft.id}/reject`, { note }); router.refresh(); })}>Send back to author</button>
        </div>
      </div>}
      <p className="small muted">Preview sessions are labelled as tests and never reach analytics. Publishing needs a reviewer other than the submitter unless the tenant allows combined roles.</p>
    </div></section>
  </div>;
}
