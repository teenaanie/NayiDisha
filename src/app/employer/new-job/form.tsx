'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actCreateJob } from '../../actions';

interface Config {
  id: string; role_family_key: string; industry_key: string; version: string;
  job_attributes: { key: string; required: boolean }[];
  critical_skills: string[]; assessment_threshold: number | null;
}
interface AttrDef { key: string; display_name: string; data_type: string; allowed_values: string[] }

const LANGS = [['mr', 'Marathi'], ['hi', 'Hindi'], ['en', 'English']];

export function NewJobForm({ employerId, locations, configs, attrDefs }: {
  employerId: string;
  locations: { id: string; name: string; locality_key: string }[];
  configs: Config[];
  attrDefs: AttrDef[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<React.ReactNode>(null);

  const [configId, setConfigId] = useState(configs[0]?.id ?? '');
  const cfg = configs.find((c) => c.id === configId);

  const [f, setF] = useState({
    title: 'Relationship Executive',
    locationId: locations[0]?.id ?? '',
    openings: 4,
    fixedPay: 19000,
    variableMax: 6000,
    shift: '09:30-18:30',
    weeklyOff: 'Sunday',
    minExperience: 6,
  });
  const [langs, setLangs] = useState<string[]>(['mr', 'hi']);
  const [skills, setSkills] = useState<string[]>(cfg?.critical_skills ?? []);
  const [attrs, setAttrs] = useState<Record<string, string>>({});

  const defFor = (k: string) => attrDefs.find((a) => a.key === k);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const valid = f.title.trim() && f.locationId && f.openings > 0 && f.fixedPay > 0 && langs.length > 0;

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-body">
        <div className="field">
          <label htmlFor="cfg">Role configuration</label>
          <select id="cfg" value={configId} onChange={(e) => {
            setConfigId(e.target.value);
            const c = configs.find((x) => x.id === e.target.value);
            setSkills(c?.critical_skills ?? []);
            setAttrs({});
          }}>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.industry_key} · {c.role_family_key.replace(/_/g, ' ').toLowerCase()} — {c.id} v{c.version}
              </option>
            ))}
          </select>
          <div className="small muted" style={{ marginTop: 5 }}>
            Only published configurations appear. The sandbox retail role is absent until it is
            published on the Operations console — that is JOB-09 working, not a missing option.
          </div>
        </div>

        {cfg && cfg.assessment_threshold !== null && (
          <div className="note small">
            Candidates for this role must score at least <strong>{cfg.assessment_threshold}</strong> on
            the readiness assessment to qualify. That threshold comes from the configuration, not from
            this form.
          </div>
        )}

        <div className="grid g2 mt">
          <div className="field">
            <label htmlFor="ti">Job title</label>
            <input id="ti" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="lo">Branch</label>
            <select id="lo" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid g3">
          <div className="field">
            <label htmlFor="op">Openings</label>
            <input id="op" type="number" min={1} value={f.openings}
                   onChange={(e) => setF({ ...f, openings: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="fp">Fixed pay (₹ / month)</label>
            <input id="fp" type="number" value={f.fixedPay}
                   onChange={(e) => setF({ ...f, fixedPay: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="vp">Variable, maximum (₹ / month)</label>
            <input id="vp" type="number" value={f.variableMax}
                   onChange={(e) => setF({ ...f, variableMax: Number(e.target.value) })} />
          </div>
        </div>

        <div className="note small">
          Fixed and variable are stored and shown separately, never as one combined figure
          (§6.6). Candidates see the guaranteed number first and the incentive as upside.
        </div>

        <div className="grid g3 mt">
          <div className="field">
            <label htmlFor="sh">Shift window</label>
            <input id="sh" value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="wo">Weekly off</label>
            <input id="wo" value={f.weeklyOff} onChange={(e) => setF({ ...f, weeklyOff: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="me">Minimum experience (months)</label>
            <input id="me" type="number" min={0} value={f.minExperience}
                   onChange={(e) => setF({ ...f, minExperience: Number(e.target.value) })} />
          </div>
        </div>

        <div className="field">
          <label>Required languages</label>
          <div className="tags" style={{ gap: 8 }}>
            {LANGS.map(([v, l]) => (
              <button key={v} type="button" className={`btn btn-sm ${langs.includes(v) ? 'btn-primary' : ''}`}
                      onClick={() => toggle(langs, setLangs, v)}>
                {langs.includes(v) ? '✓ ' : ''}{l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Critical skills <span className="muted">— defaults come from the role configuration</span></label>
          <div className="tags" style={{ gap: 8 }}>
            {(cfg?.critical_skills ?? []).map((s) => (
              <button key={s} type="button" className={`btn btn-sm ${skills.includes(s) ? 'btn-primary' : ''}`}
                      onClick={() => toggle(skills, setSkills, s)}>
                {skills.includes(s) ? '✓ ' : ''}{s.replace(/_/g, ' ').toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {cfg && cfg.job_attributes.length > 0 && (
          <>
            <h3 style={{ marginTop: 20, marginBottom: 4 }}>Role-specific fields</h3>
            <p className="small muted" style={{ marginBottom: 12 }}>
              These are generated from <code>{cfg.id}</code>. Publish a configuration with different
              fields and this section changes with no code deployment.
            </p>
            <div className="grid g2">
              {cfg.job_attributes.map((ja) => {
                const d = defFor(ja.key);
                if (!d) return null;
                return (
                  <div className="field" key={ja.key}>
                    <label htmlFor={`a-${ja.key}`}>
                      {d.display_name}{ja.required && <span style={{ color: 'var(--bad)' }}> *</span>}
                      <span className="muted mono" style={{ fontSize: '.68rem' }}> {d.data_type}</span>
                    </label>
                    {d.allowed_values?.length ? (
                      <select id={`a-${ja.key}`} value={attrs[ja.key] ?? ''}
                              onChange={(e) => setAttrs({ ...attrs, [ja.key]: e.target.value })}>
                        <option value="">—</option>
                        {d.allowed_values.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input id={`a-${ja.key}`} value={attrs[ja.key] ?? ''}
                             onChange={(e) => setAttrs({ ...attrs, [ja.key]: e.target.value })} />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="note warn small mt">
          Submitted as <strong>pending approval</strong> — JOB-02 requires operations to approve
          during the pilot. Approving it is what publishes the job, starts its 30-day clock and
          creates the posting entitlement with its ten included unlock credits.
        </div>

        <div className="btnrow mt">
          <button className="btn btn-primary" disabled={pending || !valid} onClick={() => start(async () => {try{
            const r = await actCreateJob({
              employerId, locationId: f.locationId, roleConfigId: configId,
              title: f.title, openings: f.openings,
              fixedPayRupees: f.fixedPay, variableMaxRupees: f.variableMax,
              shift: f.shift, weeklyOff: f.weeklyOff, languages: langs,
              minExperienceMonths: f.minExperience, criticalSkills: skills, attributes: attrs,
            });
            if ('error' in r) { setMsg(<span style={{ color: 'var(--bad)' }}>Rejected: {r.error}</span>); return; }
            setMsg(<>Submitted <strong>{r.jobId}</strong>. Approve it on the Operations console to publish it and issue its credits.</>);
            setTimeout(() => router.push('/ops'), 1800);
          }catch(error){setMsg(error instanceof Error?error.message:'Could not save. Please try again.');}})}>Submit for approval</button>
          <button className="btn" onClick={() => router.push('/employer')}>Cancel</button>
        </div>
        {msg && <div className="note mt small">{msg}</div>}
      </div>
    </div>
  );
}
