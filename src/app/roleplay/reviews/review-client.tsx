'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '../api';

export function ReviewForm({ runId, findings, dims }: { runId: string; findings: { rule_id: string; severity: string; source: string; learner_spans: { quote: string }[] | null }[]; dims: { dimension_id: string; score: number }[] }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, 'upheld' | 'dismissed'>>(Object.fromEntries(findings.map((f) => [f.rule_id, 'upheld'])));
  const [overrides, setOverrides] = useState<Record<string, { score: string; reason: string }>>({});
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState('');
  return <form onSubmit={async (e) => { e.preventDefault(); setError('');
    try {
      await api('POST', `evaluations/${runId}/reviews`, {
        decisions: Object.entries(decisions).map(([rule_id, decision]) => ({ rule_id, decision })),
        dimension_overrides: Object.entries(overrides).filter(([, o]) => o.score).map(([dimension_id, o]) => ({ dimension_id, score: Number(o.score), reason: o.reason })),
        rationale,
      });
      router.refresh();
    } catch (x) { setError(x instanceof ApiFailure ? x.message : 'Review failed.'); } }}>
    {findings.map((f) => <fieldset key={f.rule_id} className="field-group"><legend>{f.rule_id} · {f.severity} · found by {f.source}</legend>
      <p className="small">“{f.learner_spans?.[0]?.quote}”</p>
      <label><input type="radio" checked={decisions[f.rule_id] === 'upheld'} onChange={() => setDecisions({ ...decisions, [f.rule_id]: 'upheld' })} /> Uphold</label>
      <label><input type="radio" checked={decisions[f.rule_id] === 'dismissed'} onChange={() => setDecisions({ ...decisions, [f.rule_id]: 'dismissed' })} /> Dismiss</label>
    </fieldset>)}
    <details><summary>Override a dimension score (optional)</summary>{dims.map((d) => <div key={d.dimension_id} className="btnrow small">
      <span className="mono">{d.dimension_id} (now {d.score})</span>
      <input aria-label={`New score for ${d.dimension_id}`} type="number" style={{ width: 70 }} value={overrides[d.dimension_id]?.score ?? ''} onChange={(e) => setOverrides({ ...overrides, [d.dimension_id]: { score: e.target.value, reason: overrides[d.dimension_id]?.reason ?? '' } })} />
      <input aria-label={`Reason for ${d.dimension_id}`} placeholder="reason" value={overrides[d.dimension_id]?.reason ?? ''} onChange={(e) => setOverrides({ ...overrides, [d.dimension_id]: { score: overrides[d.dimension_id]?.score ?? '', reason: e.target.value } })} />
    </div>)}</details>
    <label className="field">Rationale (required)<textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
    <button className="btn btn-primary" disabled={!rationale.trim()}>Record review</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
