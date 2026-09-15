'use client';
import { useState } from 'react';
import { VoiceJourney } from '../voice-journey';
import { hasScreeningConsent, grantScreeningConsent, startScreening, submitBrowserScreening } from '../screening-actions';

type Lang = 'en' | 'hi' | 'mr';

const COPY: Record<Lang, Record<string, string>> = {
  en: { title:'Quick screening', intro:'Answer a few questions by voice and we will build your profile. It takes about two minutes.',
        consent:'I agree to be screened by an automated voice agent. I can withdraw this at any time.',
        begin:'Start screening', saving:'Saving your answers…', done:'Thanks — your profile is ready.',
        next:'See matching jobs', phoneNote:'Keep this page open. The questions are asked here, on this page — your phone will not ring.' },
  hi: { title:'त्वरित स्क्रीनिंग', intro:'कुछ सवालों के जवाब बोलकर दीजिए, हम आपकी प्रोफ़ाइल बना देंगे। इसमें लगभग दो मिनट लगेंगे।',
        consent:'मैं स्वचालित वॉइस एजेंट द्वारा स्क्रीनिंग के लिए सहमत हूँ। मैं इसे कभी भी वापस ले सकता/सकती हूँ।',
        begin:'स्क्रीनिंग शुरू करें', saving:'आपके जवाब सहेजे जा रहे हैं…', done:'धन्यवाद — आपकी प्रोफ़ाइल तैयार है।',
        next:'मिलती-जुलती नौकरियाँ देखें', phoneNote:'यह पेज खुला रखें। सवाल यहीं पूछे जाएँगे — आपके फ़ोन पर कॉल नहीं आएगी।' },
  mr: { title:'जलद स्क्रीनिंग', intro:'काही प्रश्नांची उत्तरं बोलून द्या, आम्ही तुमची प्रोफाइल तयार करू. सुमारे दोन मिनिटं लागतील.',
        consent:'स्वयंचलित व्हॉइस एजंटकडून स्क्रीनिंगसाठी माझी संमती आहे. मी ती कधीही मागे घेऊ शकतो/शकते.',
        begin:'स्क्रीनिंग सुरू करा', saving:'तुमची उत्तरं जतन होत आहेत…', done:'धन्यवाद — तुमची प्रोफाइल तयार आहे.',
        next:'जुळणाऱ्या नोकऱ्या पाहा', phoneNote:'हे पेज उघडं ठेवा. प्रश्न इथेच विचारले जातील — तुमच्या फोनवर कॉल येणार नाही.' },
};

export function ScreeningClient({ initialLang, consented, siteId }: {
  initialLang: Lang; consented: boolean; siteId: string | null;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [agreed, setAgreed] = useState(consented);
  const [callId, setCallId] = useState<string | null>(null);
  const [inBrowser, setInBrowser] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const t = COPY[lang];

  async function begin() {
    setBusy(true); setError('');
    try {
      if (!agreed) { await grantScreeningConsent(); setAgreed(true); }
      const r = await startScreening(lang, siteId ?? undefined);
      setCallId(r.callId); setInBrowser(r.inBrowser);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start.'); }
    finally { setBusy(false); }
  }

  async function finish(answers: Record<string, unknown>) {
    if (!callId) return;
    setBusy(true);
    try {
      const summary = Object.entries(answers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`).join('; ');
      await submitBrowserScreening(callId, answers, summary);
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="wa-msg wa-in wa-reply-panel">
      <strong>{t.done}</strong>
      <div className="btnrow mt"><a className="btn btn-primary" href="/wa/suggestions">{t.next}</a></div>
    </div>
  );

  if (callId) return (
    <>
      {inBrowser && <div className="wa-msg wa-in"><span className="small">{t.phoneNote}</span></div>}
      <VoiceJourney lang={lang} onLang={setLang} onComplete={finish} />
      {busy && <div className="wa-msg wa-in"><span className="small">{t.saving}</span></div>}
    </>
  );

  return (
    <div className="wa-msg wa-in wa-reply-panel">
      <h3>{t.title}</h3>
      <p className="small">{t.intro}</p>
      <div className="wa-lang-row">
        {(['en','hi','mr'] as Lang[]).map((l) => (
          <button key={l} type="button" className={`btn btn-sm${l === lang ? ' btn-primary' : ''}`}
                  onClick={() => setLang(l)}>{l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'मराठी'}</button>
        ))}
      </div>
      {!agreed && (
        <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontWeight:400, color:'inherit' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width:'auto', marginTop:3 }} />
          <span className="small">{t.consent}</span>
        </label>
      )}
      {error && <p className="note bad small">{error}</p>}
      <div className="btnrow mt">
        <button className="btn btn-primary" disabled={busy || !agreed} onClick={begin}>{t.begin}</button>
      </div>
    </div>
  );
}
