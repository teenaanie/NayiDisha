'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actCreatePartner } from '../../actions';

/** PART-02 — partner types are configuration values, not a fixed enum in code. */
const TYPES = [
  ['LOCAL_HIRING_AGENCY', 'Local hiring agency'],
  ['INDEPENDENT_RECRUITER', 'Freelancer / independent recruiter'],
  ['PRINT_SHOP', 'Xerox / print shop'],
  ['MOBILE_RECHARGE_SHOP', 'Mobile recharge / mobile shop'],
  ['TRAINING_CENTRE', 'Training centre'],
  ['COMMUNITY_SOURCE', 'Other approved community source'],
];
const LANGS = [['mr', 'Marathi'], ['hi', 'Hindi'], ['en', 'English']];

export function NewPartnerForm({ localities, roles }: {
  localities: { key: string; display_name: string }[];
  roles: { key: string; industry_key: string; display_name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [f, setF] = useState({
    name: 'DEMO Shree Mobile Care',
    partnerType: 'MOBILE_RECHARGE_SHOP',
    isBusiness: true,
    localityKey: 'baner',
    pan: '',
    payoutUpi: 'shreemobile@demoupi',
  });
  const [caps, setCaps] = useState<string[]>(['BFSI/RELATIONSHIP_EXECUTIVE']);
  const [langs, setLangs] = useState<string[]>(['mr', 'hi']);

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const valid = f.name.trim() && caps.length > 0 && langs.length > 0;

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="card-body">
        <div className="field">
          <label htmlFor="pn">Partner / trading name</label>
          <input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>

        <div className="grid g2">
          <div className="field">
            <label htmlFor="pt">Partner type</label>
            <select id="pt" value={f.partnerType} onChange={(e) => setF({ ...f, partnerType: e.target.value })}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pl">Service locality</label>
            <select id="pl" value={f.localityKey} onChange={(e) => setF({ ...f, localityKey: e.target.value })}>
              {localities.map((l) => <option key={l.key} value={l.key}>{l.display_name}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Sourcing capability (industry / role family)</label>
          <div className="tags" style={{ gap: 8 }}>
            {roles.map((r) => {
              const v = `${r.industry_key}/${r.key}`;
              const on = caps.includes(v);
              return (
                <button key={v} type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : ''}`}
                  onClick={() => toggle(caps, setCaps, v)}>
                  {on ? '✓ ' : ''}{r.display_name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label>Languages</label>
          <div className="tags" style={{ gap: 8 }}>
            {LANGS.map(([v, l]) => {
              const on = langs.includes(v);
              return (
                <button key={v} type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : ''}`}
                  onClick={() => toggle(langs, setLangs, v)}>
                  {on ? '✓ ' : ''}{l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid g2">
          <div className="field">
            <label htmlFor="pu">Payout UPI</label>
            <input id="pu" value={f.payoutUpi} onChange={(e) => setF({ ...f, payoutUpi: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pp">PAN (optional)</label>
            <input id="pp" value={f.pan} placeholder="leave blank to see 20% TDS"
                   onChange={(e) => setF({ ...f, pan: e.target.value })} />
          </div>
        </div>

        <div className="note small">
          Leaving PAN blank is worth doing deliberately once: under s.194H, commission above
          ₹20,000 in a financial year is withheld at 2% with a PAN and <strong>20% without one</strong>.
          The finance console shows which applies.
        </div>

        <div className="note warn small mt">
          Created as <strong>pending review</strong>. The site gets an active QR and a short printable
          code immediately, but operations must verify the partner before rewards can accrue.
        </div>

        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={pending || !valid} onClick={() => start(async () => {try{
            const r = await actCreatePartner({
              name: f.name, partnerType: f.partnerType, isBusiness: f.isBusiness,
              capabilities: caps, localityKey: f.localityKey, languages: langs,
              pan: f.pan, payoutUpi: f.payoutUpi,
            });
            if ('error' in r) { setMsg(<span style={{ color: 'var(--bad)' }}>Failed: {r.error}</span>); return; }
            setMsg(<>Created <strong>{r.partnerId}</strong>, site {r.siteId}, printable code <strong className="mono">{r.partnerCode}</strong>. Approve it on the Operations console, then open its QR from the Partner console.</>);
            router.push('/ops/partners');
          }catch(error){setMsg(error instanceof Error?error.message:'Could not save. Please try again.');}})}>{pending?'Saving…':'Create partner'}</button>
          <button className="btn" onClick={() => router.push('/ops/partners')}>Cancel</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}
