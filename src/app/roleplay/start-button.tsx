'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, newKey, ApiFailure } from './api';

type Lang = { id: string; label: string; review_status: 'source' | 'draft' | 'reviewed'; learner_brief: string };

/**
 * Start a practice. When the scenario offers more than one language the learner
 * picks one here; the brief switches with it and the whole session (customer,
 * voice, coaching) stays in that language. Draft translations are labelled.
 */
export function StartButton({ scenarioId, version, label = 'Start practice', languages }: { scenarioId: string; version?: string; label?: string; languages?: Lang[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState(languages?.[0]?.id ?? 'en');
  // One key per click: a double-click or a network retry cannot open two sessions.
  const [key, setKey] = useState(newKey);
  const chosen = languages?.find((l) => l.id === lang);
  return <div>
    {languages && <p lang={lang === 'en' ? 'en' : lang}>{chosen?.learner_brief}</p>}
    {languages && languages.length > 1 && <fieldset className="mb">
      <legend className="small"><strong>Conversation language</strong></legend>
      <div className="btnrow" role="radiogroup" aria-label="Conversation language">
        {languages.map((l) => <label key={l.id} className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 12 }}>
          <input type="radio" name={`lang-${scenarioId}`} value={l.id} aria-label={l.id === 'en' ? l.label : `${l.label} (${l.id === 'hi' ? 'Hindi' : 'Marathi'})`} checked={lang === l.id} disabled={busy} onChange={() => { setLang(l.id); setKey(newKey()); }} />
          <span lang={l.id}>{l.label}</span>
        </label>)}
      </div>
      {chosen?.review_status === 'draft' && <p className="small muted">Draft translation: still being checked by a fluent speaker.</p>}
    </fieldset>}
    <button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const r = await api('POST', 'sessions', { scenario_id: scenarioId, ...(version ? { scenario_version: version } : {}), ...(lang !== 'en' ? { language: lang } : {}) }, { idempotencyKey: key });
        router.push(`/roleplay/s/${r.data.session.session_id}`);
      } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not start.'); setBusy(false); }
    }}>{busy ? 'Starting…' : label}</button>
    {error && <p role="alert" className="small">{error}</p>}
  </div>;
}
