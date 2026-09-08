import { formatINR } from '@/lib/money';

export function Pill({ children, tone = 'mute' }: {
  children: React.ReactNode;
  tone?: 'ok' | 'warn' | 'bad' | 'info' | 'mute';
}) {
  return <span className={`pill p-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'mute'> = {
  VERIFIED: 'ok', LIVE: 'ok', ACTIVE: 'ok', PUBLISHED: 'ok', CONFIRMED: 'ok',
  ELIGIBLE: 'ok', PAID: 'ok', SIMULATED_PAID: 'ok', APPROVED: 'ok', QUALIFIED: 'ok',
  PENDING_REVIEW: 'warn', PENDING_APPROVAL: 'warn', IN_HOLD: 'warn', UNDER_REVIEW: 'warn',
  SANDBOX: 'warn', DRAFT: 'warn', PENDING: 'warn', OPEN: 'warn',
  SUSPENDED: 'bad', REJECTED: 'bad', REVERSED: 'bad', FAILED: 'bad', EXPIRED: 'mute',
  FLAGGED: 'bad', NOT_QUALIFIED: 'bad', WITHDRAWN: 'bad', REPLACED: 'bad', DISPUTED: 'bad',
  UNLOCKED: 'info', PREVIEWED: 'info', CANDIDATE_RECONFIRMED: 'info', APPLIED: 'info',
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'mute'}>{status.replace(/_/g, ' ')}</Pill>;
}

export function Stat({ k, v, d }: { k: string; v: React.ReactNode; d?: React.ReactNode }) {
  return (
    <div className="card stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}

export function Money({ paise, decimals }: { paise: number | string; decimals?: boolean }) {
  return <span className="mono">{formatINR(Number(paise), { decimals })}</span>;
}

export function Clause({ children }: { children: React.ReactNode }) {
  return <span className="clause">{children}</span>;
}

/** A deterministic pseudo-QR block. Encodes nothing — the code beneath it does. */
export function QrBlock({ seed }: { seed: string }) {
  const N = 25;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const cells: [number, number][] = [];
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (inFinder(x, y)) continue;
      if (rand() > 0.52) cells.push([x, y]);
    }
  }
  const finder = (ox: number, oy: number) => (
    <g key={`f${ox}-${oy}`}>
      <rect x={ox} y={oy} width="7" height="7" fill="#0B1A17" />
      <rect x={ox + 1} y={oy + 1} width="5" height="5" fill="#fff" />
      <rect x={ox + 2} y={oy + 2} width="3" height="3" fill="#0B1A17" />
    </g>
  );
  return (
    <div className="qr-box">
      <svg viewBox={`0 0 ${N} ${N}`} shapeRendering="crispEdges" aria-hidden="true">
        <rect width={N} height={N} fill="#fff" />
        {finder(0, 0)}{finder(N - 7, 0)}{finder(0, N - 7)}
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0B1A17" />
        ))}
      </svg>
    </div>
  );
}

export function ScoreBars({ components, endorsement }: {
  components: Record<string, { raw: number; weight: number; weighted: number }>;
  endorsement: number;
}) {
  const label: Record<string, string> = {
    jobPreference: 'Job preference', commute: 'Commute', compensation: 'Compensation',
    schedule: 'Schedule', language: 'Language', experience: 'Experience',
    criticalSkills: 'Critical skills', assessment: 'Assessment',
  };
  // Fixed display order — JSONB key order is not guaranteed, and a breakdown
  // that reshuffles between renders is unreadable.
  const ORDER = ['jobPreference', 'commute', 'compensation', 'schedule',
                 'language', 'experience', 'criticalSkills', 'assessment'];
  const ordered = ORDER.filter((k) => k in components).map((k) => [k, components[k]] as const)
    .concat(Object.entries(components).filter(([k]) => !ORDER.includes(k)) as never);
  return (
    <div className="bars">
      {ordered.map(([k, c]) => (
        <div className="bar" key={k}>
          <span>{label[k] ?? k}</span>
          <span className="track"><span className="fill" style={{ width: `${c.raw}%` }} /></span>
          <span className="val">{c.weighted.toFixed(1)}/{c.weight}</span>
        </div>
      ))}
      <div className="bar">
        <span className="muted">Endorsement</span>
        <span className="track"><span className="fill" style={{ width: `${endorsement * 20}%`, background: 'var(--ok)' }} /></span>
        <span className="val">+{endorsement}</span>
      </div>
    </div>
  );
}

export function Tags({ items, tone }: { items: string[]; tone?: 'good' | 'gap' }) {
  if (!items?.length) return <span className="muted small">—</span>;
  return (
    <span className="tags">
      {items.map((t) => <span key={t} className={`tag ${tone ?? ''}`}>{t.replace(/_/g, ' ').toLowerCase()}</span>)}
    </span>
  );
}
