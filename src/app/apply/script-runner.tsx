'use client';
import { useState } from 'react';
import { VoiceJourney, type VoiceStep } from '../wa/voice-journey';
import { beginScript, interpretScriptAnswer, acceptScriptAnswer, finishScript } from './script-actions';

type Lang = 'en' | 'hi' | 'mr';

const COPY: Record<Lang, Record<string, string>> = {
  en: { intro: 'A few questions about this job', start: 'Start the questions', close: 'These are specific to the role you chose. Answer in your own words — there is no trick answer.',
        done: 'Thank you. Your answers have been recorded.', scored: 'Your score', of: 'of 100', pass: 'You meet the bar for this role.',
        below: 'You are below the bar for this role for now.', review: 'Some answers are waiting for a person to review.', again: 'Try again' },
  hi: { intro: 'इस नौकरी के बारे में कुछ सवाल', start: 'सवाल शुरू करें', close: 'ये आपके चुने हुए काम से जुड़े हैं। अपने शब्दों में जवाब दीजिए — कोई चालाकी वाला जवाब नहीं है।',
        done: 'धन्यवाद। आपके जवाब दर्ज हो गए हैं।', scored: 'आपका स्कोर', of: '100 में से', pass: 'आप इस भूमिका के लिए योग्य हैं।',
        below: 'फ़िलहाल आप इस भूमिका के स्तर से नीचे हैं।', review: 'कुछ जवाबों की समीक्षा बाकी है।', again: 'फिर से कोशिश करें' },
  mr: { intro: 'या नोकरीबद्दल काही प्रश्न', start: 'प्रश्न सुरू करा', close: 'हे तुम्ही निवडलेल्या कामाशी संबंधित आहेत. तुमच्या शब्दांत उत्तर द्या — इथे फसवं उत्तर काहीच नाही.',
        done: 'धन्यवाद. तुमची उत्तरं नोंदवली आहेत.', scored: 'तुमचा स्कोअर', of: '100 पैकी', pass: 'तुम्ही या भूमिकेसाठी पात्र आहात.',
        below: 'सध्या तुम्ही या भूमिकेच्या पातळीपेक्षा खाली आहात.', review: 'काही उत्तरांची तपासणी बाकी आहे.', again: 'पुन्हा प्रयत्न करा' },
};

/**
 * Runs a role's own script after the candidate has picked a job.
 *
 * All the speech handling is VoiceJourney's; only the questions and the three
 * server calls differ. That is the whole point of the split — the conversation
 * machinery is role-agnostic, the questions are not.
 */
export function ScriptRunner({ lang, onLang, jobId, jobTitle }: {
  lang: Lang; onLang: (l: Lang) => void; jobId?: string; jobTitle?: string;
}) {
  const t = COPY[lang];
  const [steps, setSteps] = useState<VoiceStep[] | null>(null);
  const [result, setResult] = useState<{ score: number; passed: boolean; passThreshold: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setError('');
    try {
      const r = await beginScript(jobId);
      // VoiceJourney calls the question key `field`; a script calls it `key`.
      setSteps(r.steps.map((x) => ({ field: x.key, ask: x.ask })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the questions.');
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <div className="wa-msg wa-in">
        <strong>{t.done}</strong>
        <p className="small">{t.scored}: <strong>{result.score}</strong> {t.of}</p>
        <p className="small">{result.passed ? t.pass : t.below}</p>
      </div>
    );
  }

  if (!steps) {
    return (
      <div className="wa-msg wa-in">
        <strong>{t.intro}{jobTitle ? ` — ${jobTitle}` : ''}</strong>
        <p className="small">{t.close}</p>
        {error && <p className="small" role="alert">{error}</p>}
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          {busy ? '…' : error ? t.again : t.start}
        </button>
      </div>
    );
  }

  return (
    <VoiceJourney
      lang={lang}
      onLang={onLang}
      script={steps}
      interpret={(field, transcript, l) => interpretScriptAnswer(field, transcript, l)}
      accept={(field, ctx) => acceptScriptAnswer(field, ctx.transcript, lang, ctx.value, ctx.display)}
      onFinished={async () => { const r = await finishScript(); setResult(r); }}
      onComplete={() => {}}
    />
  );
}
