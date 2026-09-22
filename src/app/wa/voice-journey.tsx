'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { interpretAnswer, acceptAnswer, auditVoiceCompleted } from './voice-actions';

type Lang = 'en' | 'hi' | 'mr';
type Field = 'name' | 'locality' | 'experienceMonths' | 'skills' | 'expectedPay' | 'commute' | 'shifts';

/** BCP-47 tags the browser's speech engine expects. */
const SPEECH_LANG: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

/**
 * The question script. Each question is spoken aloud and shown as a chat
 * bubble, exactly as a WhatsApp voice bot would send a voice note plus text.
 */
const SCRIPT: { field: Field; ask: Record<Lang, string> }[] = [
  { field: 'name', ask: {
    en: 'What is your name?',
    hi: 'आपका नाम क्या है?',
    mr: 'तुमचं नाव काय आहे?' } },
  { field: 'locality', ask: {
    en: 'Which area of Pune do you live in?',
    hi: 'आप पुणे के किस इलाके में रहते हैं?',
    mr: 'तुम्ही पुण्याच्या कोणत्या भागात राहता?' } },
  { field: 'experienceMonths', ask: {
    en: 'How much work experience do you have? You can say it in months or years.',
    hi: 'आपके पास कितना काम का अनुभव है? महीनों या सालों में बताइए।',
    mr: 'तुम्हाला किती कामाचा अनुभव आहे? महिने किंवा वर्षांत सांगा.' } },
  { field: 'skills', ask: {
    en: 'What work have you done before? Name a few skills.',
    hi: 'आपने पहले क्या काम किया है? कुछ कौशल बताइए।',
    mr: 'तुम्ही आधी कोणतं काम केलं आहे? काही कौशल्यं सांगा.' } },
  { field: 'expectedPay', ask: {
    en: 'What monthly salary are you expecting?',
    hi: 'आप हर महीने कितनी तनख़्वाह चाहते हैं?',
    mr: 'तुम्हाला दरमहा किती पगार अपेक्षित आहे?' } },
  { field: 'commute', ask: {
    en: 'How far can you travel to work? Say it in minutes.',
    hi: 'आप काम के लिए कितनी दूर जा सकते हैं? मिनटों में बताइए।',
    mr: 'तुम्ही कामासाठी किती लांब जाऊ शकता? मिनिटांत सांगा.' } },
  { field: 'shifts', ask: {
    en: 'Which shift suits you? You can say any shift.',
    hi: 'कौन सी शिफ्ट आपके लिए ठीक है? आप कोई भी शिफ्ट कह सकते हैं।',
    mr: 'कोणती शिफ्ट तुम्हाला योग्य आहे? तुम्ही कोणतीही शिफ्ट म्हणू शकता.' } },
];

const UI: Record<Lang, Record<string, string>> = {
  en: { tap:'Tap to speak', listening:'Listening…', thinking:'NayiDisha is listening…', heard:'I heard',
        correct:'Yes, correct', retry:'No, say again', type:'Type instead', done:'All done',
        unclear:'I did not catch that. Please say it again.', review:'Here is what I understood',
        save:'Save and continue', unsupported:'Your browser cannot record voice. You can type your answers instead.',
        mic:'Microphone blocked. Allow microphone access, or type your answer.', answerIn:'Answer in', restart:'Start over', stop:'Tap to stop', nothing:'I did not hear anything. Tap the mic and speak.' },
  hi: { tap:'बोलने के लिए दबाएँ', listening:'सुन रहे हैं…', thinking:'NayiDisha सुन रहा है…', heard:'मैंने सुना',
        correct:'हाँ, सही है', retry:'नहीं, फिर से बोलूँ', type:'टाइप करें', done:'पूरा हुआ',
        unclear:'मैं समझ नहीं पाया। कृपया फिर से बोलिए।', review:'मैंने यह समझा',
        save:'सहेजें और आगे बढ़ें', unsupported:'आपका ब्राउज़र आवाज़ रिकॉर्ड नहीं कर सकता। आप टाइप कर सकते हैं।',
        mic:'माइक्रोफ़ोन बंद है। अनुमति दें, या टाइप करें।', answerIn:'जवाब की भाषा', restart:'फिर से शुरू करें', stop:'रोकने के लिए दबाएँ', nothing:'कुछ सुनाई नहीं दिया। माइक दबाकर बोलिए।' },
  mr: { tap:'बोलण्यासाठी दाबा', listening:'ऐकत आहे…', thinking:'NayiDisha ऐकत आहे…', heard:'मी ऐकलं',
        correct:'होय, बरोबर', retry:'नाही, पुन्हा सांगतो', type:'टाइप करा', done:'पूर्ण झालं',
        unclear:'मला समजलं नाही. कृपया पुन्हा सांगा.', review:'मला हे समजलं',
        save:'जतन करा आणि पुढे जा', unsupported:'तुमचा ब्राउझर आवाज रेकॉर्ड करू शकत नाही. तुम्ही टाइप करू शकता.',
        mic:'मायक्रोफोन बंद आहे. परवानगी द्या, किंवा टाइप करा.', answerIn:'उत्तराची भाषा', restart:'पुन्हा सुरू करा', stop:'थांबवण्यासाठी दाबा', nothing:'काहीच ऐकू आलं नाही. माइक दाबून बोला.' },
};

interface Turn { who: 'bot' | 'me'; text: string; voice?: boolean; seconds?: number }

/** One question in a script. `field` is a profile field or a script turn key. */
export interface VoiceStep { field: string; ask: Record<Lang, string> }

/**
 * The speech machinery — recognition, endpointing, read-back, typing fallback —
 * is identical whether the questions come from the built-in profile script or
 * from a role configuration. So the script and the three server calls are
 * injectable, and default to the profile journey's own.
 */
export function VoiceJourney({
  lang, onLang, onComplete,
  script = SCRIPT,
  interpret = interpretAnswer,
  accept = (field: string) => acceptAnswer(field),
  onFinished = auditVoiceCompleted,
}: {
  lang: Lang;
  onLang: (l: Lang) => void;
  onComplete: (answers: Record<string, unknown>) => void;
  script?: VoiceStep[];
  interpret?: (field: string, transcript: string, lang: Lang) => Promise<{
    value: unknown; display: string; confidence: number;
    needsConfirmation: boolean; understood: boolean;
  }>;
  /** Called once the candidate has accepted the answer. `ctx` carries what a
   *  rubric scorer needs, which the default profile journey ignores. */
  accept?: (field: string, ctx: { value: unknown; display: string; transcript: string; confidence: number }) => Promise<void>;
  onFinished?: () => Promise<void>;
}) {
  const t = UI[lang];
  const [index, setIndex] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ value: unknown; display: string; confidence: number } | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [typing, setTyping] = useState(false);
  const [supported, setSupported] = useState(true);
  const [partial, setPartial] = useState('');
  const recognition = useRef<any>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalText = useRef(''); const interimText = useRef('');
  /** One answer per listening session, whichever path finishes first. */
  const submitted = useRef(false);
  const startedAt = useRef(0);
  /** The raw transcript behind the answer awaiting confirmation. */
  const lastTranscript = useRef('');
  const bottom = useRef<HTMLDivElement>(null);

  const step = script[index];
  const finished = index >= script.length;

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [turns, pendingConfirm]);

  useEffect(() => {
    const SR = typeof window !== 'undefined'
      && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!SR) { setSupported(false); setTyping(true); return; }
    const r = new SR();
    // Endpointing is left to us rather than the browser: on mobile the built-in
    // end-of-speech detection is unreliable and can simply never fire, which
    // strands the candidate mid-answer. interimResults also gives them visible
    // proof it is hearing them.
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    recognition.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []);

  useEffect(() => { if (recognition.current) recognition.current.lang = SPEECH_LANG[lang]; }, [lang]);

  /** Speak the question, the way a WhatsApp voice note would arrive. */
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = SPEECH_LANG[lang];
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang === SPEECH_LANG[lang])
        ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang));
      if (voice) u.voice = voice;
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* speech synthesis is a nicety, never a blocker */ }
  }, [lang]);

  // Ask each question as it comes up — and re-ask in the new language if the
  // candidate switches language partway through.
  useEffect(() => {
    if (finished) return;
    const q = step.ask[lang];
    setTurns((prev) => prev.some((x) => x.who === 'bot' && x.text === q) ? prev : [...prev, { who: 'bot', text: q }]);
    speak(q);
  }, [index, lang, finished, step, speak]);

  async function handleTranscript(transcript: string) {
    lastTranscript.current = transcript;
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    setTurns((prev) => [...prev, { who: 'me', text: transcript, voice: !typing, seconds }]);
    setBusy(true); setError('');
    try {
      const r = await interpret(step.field, transcript, lang);
      if (!r.understood) {
        setTurns((prev) => [...prev, { who: 'bot', text: t.unclear }]);
        speak(t.unclear);
      } else if (r.needsConfirmation) {
        const line = `${t.heard}: ${r.display}`;
        setTurns((prev) => [...prev, { who: 'bot', text: line }]);
        speak(line);
        setPendingConfirm({ value: r.value, display: r.display, confidence: r.confidence });
      } else {
        await commit(r.value, r.display, r.confidence);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  async function commit(value: unknown, display: string, confidence = 0) {
    await accept(step.field, { value, display, transcript: lastTranscript.current, confidence }).catch(() => {});
    const next = { ...answers, [step.field]: value };
    setAnswers(next);
    setPendingConfirm(null);
    setTurns((prev) => [...prev, { who: 'bot', text: `✓ ${display}` }]);
    if (index + 1 >= script.length) {
      await onFinished().catch(() => {});
      onComplete(next);
    }
    setIndex((i) => i + 1);
  }

  function restart() {
    try { window.speechSynthesis?.cancel(); } catch {}
    setPendingConfirm(null); setAnswers({}); setTurns([]); setError(''); setIndex(0);
  }

  /** Stop after this much quiet once they have started speaking. */
  const SILENCE_MS = 2500;
  /** Longer grace before the first word, so thinking time is not cut off. */
  const FIRST_WORD_MS = 7000;
  /** Nothing may listen forever, whatever the speech engine does. */
  const MAX_MS = 25000;

  function clearTimers() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    silenceTimer.current = null; maxTimer.current = null;
  }

  function submitOnce(text: string) {
    if (submitted.current) return;
    submitted.current = true;
    setPartial('');
    if (text) handleTranscript(text); else setError(t.nothing);
  }

  function stopListening() {
    clearTimers();
    try { recognition.current?.stop(); } catch { setListening(false); return; }
    // If the engine never fires onend — it happens — do not leave the candidate
    // stuck on a listening button with no way out.
    maxTimer.current = setTimeout(() => {
      setListening(false);
      submitOnce((finalText.current + interimText.current).trim());
    }, 1500);
  }

  useEffect(() => () => { clearTimers(); try { recognition.current?.abort(); } catch {} }, []);

  function listen() {
    // Tapping while it listens stops and submits — never a dead end.
    if (listening) { stopListening(); return; }

    const r = recognition.current;
    if (!r) { setTyping(true); return; }
    finalText.current = ''; interimText.current = ''; submitted.current = false;
    setPartial(''); setError(''); setListening(true); startedAt.current = Date.now();

    const arm = (ms: number) => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(stopListening, ms);
    };

    r.onresult = (ev: any) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText.current += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      interimText.current = interim;
      setPartial((finalText.current + interim).trim());
      arm(SILENCE_MS);
    };

    r.onerror = (ev: any) => {
      clearTimers(); setListening(false); setPartial(''); submitted.current = true;
      if (ev?.error === 'no-speech' || ev?.error === 'aborted') { setError(t.nothing); return; }
      setError(ev?.error === 'not-allowed' ? t.mic : t.unclear);
      if (ev?.error === 'not-allowed') setTyping(true);
    };

    // Whether it ended by silence, by tap or by the engine itself, submit
    // whatever was captured rather than discarding it.
    r.onend = () => {
      clearTimers(); setListening(false);
      submitOnce((finalText.current + interimText.current).trim());
    };

    try {
      r.start();
      arm(FIRST_WORD_MS);
      maxTimer.current = setTimeout(stopListening, MAX_MS);
    } catch { clearTimers(); setListening(false); }
  }

  return (
    <div className="wa-voice">
      {!supported && <p className="wa-voice-note">{t.unsupported}</p>}

      {turns.map((turn, i) => (
        <div key={i} className={`wa-msg ${turn.who === 'bot' ? 'wa-in' : 'wa-out'}`}>
          {turn.voice
            ? <span className="wa-voicenote">
                <span className="wa-voicenote-play" aria-hidden="true">▶</span>
                <span className="wa-wave" aria-hidden="true">
                  {Array.from({ length: 22 }, (_, b) => (
                    <i key={b} style={{ height: `${20 + ((b * 37) % 60)}%` }} />
                  ))}
                </span>
                <span className="wa-voicenote-time">0:{String(turn.seconds ?? 1).padStart(2, '0')}</span>
              </span>
            : turn.text}
          {turn.voice && <div className="wa-voicenote-transcript">“{turn.text}”</div>}
          <div className="wa-meta">{turn.who === 'bot' ? 'NayiDisha' : 'You · ✓✓'}</div>
        </div>
      ))}
      <div ref={bottom} />

      {!finished && (
        <div className="wa-msg wa-in wa-reply-panel" aria-busy={busy}>
          <div className="wa-lang-row">
            <span>{t.answerIn}</span>
            {(['en','hi','mr'] as Lang[]).map((l) => (
              <button key={l} type="button" disabled={busy || listening}
                      className={`btn btn-sm${l === lang ? ' btn-primary' : ''}`}
                      onClick={() => { setPendingConfirm(null); onLang(l); }}>
                {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'मराठी'}
              </button>
            ))}
            {index > 0 && (
              <button type="button" className="btn btn-sm wa-restart" disabled={busy || listening}
                      onClick={restart}>↺ {t.restart}</button>
            )}
          </div>
          <p role="status">{busy ? t.thinking : error}</p>

          {pendingConfirm ? (
            <div className="btnrow">
              <button type="button" className="btn btn-primary" disabled={busy}
                      onClick={() => commit(pendingConfirm.value, pendingConfirm.display, pendingConfirm.confidence)}>{t.correct}</button>
              <button type="button" className="btn" disabled={busy}
                      onClick={() => { setPendingConfirm(null); setTurns((p) => [...p, { who: 'bot', text: step.ask[lang] }]); speak(step.ask[lang]); }}>{t.retry}</button>
            </div>
          ) : typing ? (
            <form onSubmit={(e) => { e.preventDefault();
                    const el = (e.currentTarget.elements.namedItem('answer') as HTMLInputElement);
                    if (el.value.trim()) { handleTranscript(el.value.trim()); el.value = ''; } }}>
              <label className="field">{step.ask[lang]}
                <input name="answer" autoComplete="off" disabled={busy} />
              </label>
              <div className="btnrow">
                <button className="btn btn-primary" disabled={busy}>{t.save}</button>
                {supported && <button type="button" className="btn" onClick={() => setTyping(false)}>🎤 {t.tap}</button>}
              </div>
            </form>
          ) : (
            <div className="wa-mic-row">
              <button type="button" className={`wa-mic ${listening ? 'is-listening' : ''}`}
                      onClick={listen} disabled={busy}
                      aria-label={listening ? t.stop : t.tap}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
                  <path d="M12 18v3" />
                </svg>
              </button>
              <div>
                <strong>{listening ? (partial ? t.listening : t.stop) : t.tap}</strong>
                {partial && <span className="wa-partial">“{partial}”</span>}
                {!listening && (
                  <button type="button" className="btn btn-sm" onClick={() => setTyping(true)}>{t.type}</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="wa-msg wa-in wa-reply-panel">
          <div className="wa-lang-row">
            <strong style={{ flex: 1 }}>{t.done}</strong>
            <button type="button" className="btn btn-sm wa-restart" onClick={restart}>↺ {t.restart}</button>
          </div>
          <p className="small">{t.review}:</p>
          <ul className="wa-voice-review">
            {script.map((s) => answers[s.field] !== undefined && (
              <li key={s.field}><span>{s.field.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                <strong>{Array.isArray(answers[s.field]) ? (answers[s.field] as string[]).join(', ') : String(answers[s.field])}</strong></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
