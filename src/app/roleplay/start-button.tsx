'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, newKey, ApiFailure } from './api';

export function StartButton({ scenarioId, version, label = 'Start practice' }: { scenarioId: string; version?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per click: a double-click or a network retry cannot open two sessions.
  const [key] = useState(newKey);
  return <div>
    <button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const r = await api('POST', 'sessions', { scenario_id: scenarioId, ...(version ? { scenario_version: version } : {}) }, { idempotencyKey: key });
        router.push(`/roleplay/s/${r.data.session.session_id}`);
      } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not start.'); setBusy(false); }
    }}>{busy ? 'Starting…' : label}</button>
    {error && <p role="alert" className="small">{error}</p>}
  </div>;
}
