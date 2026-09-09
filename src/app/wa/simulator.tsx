'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  actWaStart, actWaVerify, actWaProfile, actWaAssessment,
  actWaEndorse, actWaApply, actWaWithdraw,
} from '../actions';
import { formatINR } from '@/lib/money';

const DEMO_OTP = '123456';

interface Props {
  site: { code: string; partnerName: string; siteId: string; partnerId: string; valid: boolean } | null;
  localities: { key: string; display_name: string }[];
  jobs: { id: string; title: string; brand: string; loc: string; locality_key: string;
          fixed_pay_paise: string; variable_max_paise: string; shift: string }[];
  assessment: { id: string; questions: { id: string; prompt: string; options: string[]; answer: string; marks: number }[] };
  existing: { id: string; name: string | null; status: string } | null;
  history: { id: string; direction: string; body: string; category: string | null }[];
}

type Step = 'start' | 'otp' | 'profile' | 'assess' | 'endorse' | 'jobs' | 'done';

export function Simulator(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(p.existing ? 'jobs' : 'start');
  const [candidateId, setCandidateId] = useState<string | null>(p.existing?.id ?? null);
  const [pendingAttr, setPendingAttr] = useState<Props['site'] extends null ? null : {
    siteId: string | null; partnerId: string | null; method: 'QR'|'PARTNER_CODE'|'DIRECT'; valid: boolean } | null>(null);
  const [bubbles, setBubbles] = useState<{ me: boolean; text: string }[]>(
    p.history.map((h) => ({ me: h.direction === 'INBOUND', text: h.body })),
  );

  const [phone, setPhone] = useState('+910000000042');
  const [lang, setLang] = useState<'mr' | 'hi' | 'en'>('hi');
  const [typedCode, setTypedCode] = useState(p.site?.code ?? '');
  const [otp, setOtp] = useState('');
  const [form, setForm] = useState({
    name: 'DEMO Rekha Salunke', localityKey: 'shivajinagar', experienceMonths: 14,
    tags: 'FIELD_SALES,CUSTOMER_COMMUNICATION', languages: 'mr,hi',
    expectedPay: 19000, currentPay: 16000, maxCommuteMin: 45,
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<number | null>(null);
  const [applyResult, setApplyResult] = useState<Record<string, string>>({});
  const [endorseLink, setEndorseLink] = useState<string | null>(null);

  const say = (me: boolean, text: string) => setBubbles((b) => [...b, { me, text }]);

  return (
    <div className="wa-phone">
      <div className="wa-top">
        <span className="avatar">FH</span>
        <span>Frontline Jobs · Pune<div style={{ fontSize: '.68rem', opacity: .85, fontWeight: 400 }}>demo simulator</div></span>
      </div>

      <div className="wa-body">
        {bubbles.length === 0 && (
          <div className="wa-msg wa-in muted">
            Scan a partner QR or press Start to begin the journey.
          </div>
        )}
        {bubbles.map((b, i) => (
          <div key={i} className={`wa-msg ${b.me ? 'wa-out' : 'wa-in'}`}>{b.text}</div>
        ))}
      </div>

      <div className="wa-actions">
        {step === 'start' && (
          <>
            <div className="field">
              <label htmlFor="ph">Mobile number (non-routable demo range)</label>
              <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="lg">Language</label>
              <select id="lg" value={lang} onChange={(e) => setLang(e.target.value as 'mr'|'hi'|'en')}>
                <option value="mr">मराठी — Marathi</option>
                <option value="hi">हिन्दी — Hindi</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cd">Partner code (optional — typed fallback for a failed scan)</label>
              <input id="cd" value={typedCode} placeholder="e.g. DCS101"
                     onChange={(e) => setTypedCode(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
              say(true, 'Hi');
              const r = await actWaStart(phone, lang, typedCode || null);
              setCandidateId(r.candidateId);
              setPendingAttr(r.returning ? null : (r.pendingAttribution ?? null));
              if (r.returning) {
                say(false, 'Welcome back. You already have a profile with us.');
                setStep('jobs');
              } else {
                say(false, lang === 'mr'
                  ? 'नमस्कार! ही नोकरी शोधण्याची मोफत सेवा आहे.'
                  : lang === 'hi'
                  ? 'नमस्ते! यह नौकरी खोजने की मुफ़्त सेवा है।'
                  : 'Hello! This is a free job-finding service.');
                say(false, `Your verification code is ${DEMO_OTP}.`);
                setStep('otp');
              }
            })}>Start conversation</button>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className="field">
              <label htmlFor="otp">Enter the code you received (demo: {DEMO_OTP})</label>
              <input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6 digits" />
            </div>
            <button className="btn btn-primary" disabled={pending || otp.length !== 6} onClick={() => start(async () => {
              say(true, otp);
              await actWaVerify(candidateId!, pendingAttr ?? (p.site ? {
                siteId: p.site.siteId, partnerId: p.site.partnerId, method: 'QR', valid: p.site.valid,
              } : null));
              say(false, 'Verified. We store your name, pincode, experience and expected pay — only to show you jobs. You can withdraw this at any time.');
              if (p.site) {
                say(false, `You came through ${p.site.partnerName}. If that is not right, reply "change".`);
              }
              setStep('profile');
            })}>Verify</button>
          </>
        )}

        {step === 'profile' && (
          <>
            <div className="field">
              <label htmlFor="nm">Name</label>
              <input id="nm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="lc">Locality</label>
              <select id="lc" value={form.localityKey} onChange={(e) => setForm({ ...form, localityKey: e.target.value })}>
                {p.localities.map((l) => <option key={l.key} value={l.key}>{l.display_name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label htmlFor="ex">Experience (months)</label>
                <input id="ex" type="number" value={form.experienceMonths}
                       onChange={(e) => setForm({ ...form, experienceMonths: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor="cm">Max commute (min)</label>
                <input id="cm" type="number" value={form.maxCommuteMin}
                       onChange={(e) => setForm({ ...form, maxCommuteMin: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor="cp">Current pay (₹/month)</label>
                <input id="cp" type="number" value={form.currentPay}
                       onChange={(e) => setForm({ ...form, currentPay: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor="ep">Expected pay (₹/month)</label>
                <input id="ep" type="number" value={form.expectedPay}
                       onChange={(e) => setForm({ ...form, expectedPay: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tg">Experience tags</label>
              <input id="tg" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
              say(true, `${form.name}, ${form.localityKey.replace(/_/g, ' ')}, ${form.experienceMonths} months`);
              await actWaProfile(candidateId!, {
                name: form.name, localityKey: form.localityKey,
                experienceMonths: form.experienceMonths,
                experienceTags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
                languages: form.languages.split(',').map((s) => s.trim()),
                expectedPay: form.expectedPay, currentPay: form.currentPay,
                maxCommuteMin: form.maxCommuteMin,
              });
              say(false, 'Thank you. Now a short readiness check — five questions, no confidential banking information.');
              setStep('assess');
            })}>Save profile</button>
          </>
        )}

        {step === 'assess' && (
          <>
            <div className="small muted mb">Readiness check · {p.assessment.questions.length} questions</div>
            {p.assessment.questions.map((q, i) => (
              <div className="field" key={q.id}>
                <label htmlFor={q.id}>{i + 1}. {q.prompt}</label>
                <select id={q.id} value={answers[q.id] ?? ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                  <option value="">Choose…</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <button className="btn btn-primary"
                    disabled={pending || Object.keys(answers).length < p.assessment.questions.length}
                    onClick={() => start(async () => {
              const r = await actWaAssessment(candidateId!, p.assessment.id, answers);
              setScore(r.score);
              say(true, 'Submitted');
              say(false, `Your readiness score is ${r.score}. ${r.score >= 60 ? 'That meets the requirement for these roles.' : 'That is below the requirement of 60 for these roles — you can still see jobs and improve.'}`);
              setStep('endorse');
            })}>Submit answers</button>
          </>
        )}

        {step === 'endorse' && (
          <>
            <div className="small muted mb">
              Ask a former manager or senior colleague to vouch for you. They verify by OTP; you cannot
              write it yourself, and it can never override a job requirement.
            </div>
            <div className="btnrow">
              <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
                const r = await actWaEndorse(candidateId!, 'DEMO Suresh Kale', '+910000009050', 'FORMER_MANAGER');
                say(true, 'Invite my former manager');
                say(false, 'Invitation sent to your former manager. They fill it in themselves — you cannot write it for them.');
                setEndorseLink(r.link);
              })}>Invite former manager</button>
              <button className="btn" disabled={pending} onClick={() => setStep('jobs')}>Skip</button>
            </div>
            {endorseLink && (
              <div className="note small mt">
                Open the endorser&apos;s page in a new tab — no login, they verify a code and write
                their own words:{' '}
                <a href={endorseLink} target="_blank" rel="noreferrer">{endorseLink}</a>
                <div className="btnrow mt">
                  <button className="btn btn-sm" onClick={() => setStep('jobs')}>Continue to jobs</button>
                </div>
              </div>
            )}
          </>
        )}

        {step === 'jobs' && (
          <>
            <div className="small muted mb">Jobs near you. Applying is always free.</div>
            {p.jobs.map((jb) => (
              <div key={jb.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: 11 }}>
                  <strong className="small">{jb.title}</strong>
                  <div className="small muted">{jb.brand} · {jb.loc}</div>
                  <div className="small mono" style={{ margin: '5px 0' }}>
                    {formatINR(Number(jb.fixed_pay_paise))} fixed
                    {Number(jb.variable_max_paise) > 0 && <> + up to {formatINR(Number(jb.variable_max_paise))} variable</>}
                  </div>
                  <div className="btnrow">
                    <button className="btn btn-sm btn-primary" disabled={pending || !!applyResult[jb.id]}
                            onClick={() => start(async () => {
                      say(true, `Apply — ${jb.title}`);
                      const r = await actWaApply(candidateId!, jb.id);
                      setApplyResult((s) => ({ ...s, [jb.id]: r.qualified ? `qualified · score ${r.score}` : 'not qualified' }));
                      say(false, r.qualified
                        ? `Your application has gone to ${jb.brand}. You are a qualified profile for this role.`
                        : `Your application is recorded, but you are not currently qualified for this role: ${r.gaps.slice(0, 2).join(', ').toLowerCase().replace(/_/g, ' ')}.`);
                    })}>Apply</button>
                    {applyResult[jb.id] && <span className="small muted">{applyResult[jb.id]}</span>}
                  </div>
                </div>
              </div>
            ))}
            <div className="btnrow mt">
              <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
                await actWaWithdraw(candidateId!);
                say(true, 'Stop and delete my data');
                say(false, 'You will not get job messages any more. Applications not yet opened by an employer have been withdrawn.');
                setStep('done');
              })}>Withdraw consent</button>
              <button className="btn btn-sm" onClick={() => router.push('/employer')}>
                See it from the employer side →
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="small muted">
            Consent withdrawn. Unlocks already completed are not unwound — the employer received what
            it paid for — and that is stated to the candidate rather than applied silently.
            <div className="btnrow mt">
              <button className="btn btn-sm" onClick={() => { setStep('start'); setBubbles([]); setCandidateId(null); }}>
                Start a new candidate
              </button>
            </div>
          </div>
        )}

        {candidateId && (
          <div className="small muted mt" style={{ fontFamily: 'var(--mono)', fontSize: '.7rem' }}>
            candidate {candidateId}{score !== null && ` · assessment ${score}`}
          </div>
        )}
      </div>
    </div>
  );
}
