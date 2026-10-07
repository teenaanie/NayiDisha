'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../../api';

/**
 * Voice for the practice screen.
 *
 * Recognition fills the message box; it never sends. The learner reads what
 * was heard, corrects it, and sends it like a typed message, so assessment
 * only ever sees words the learner confirmed (spec §3). The raw transcript and
 * recogniser travel with the turn as provenance.
 */

export interface VoiceCaps { recognition: 'server' | 'browser'; speech: 'server' | 'browser'; server_provider: string | null; language: string; notice: string; consent: boolean }
export interface VoiceMeta { mode: 'voice'; asr_provider: string; asr_text: string; asr_confidence: number | null }

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null;
  start(): void; stop(): void; abort(): void;
};
const browserRecognition = (): (new () => Recognition) | null =>
  typeof window === 'undefined' ? null : ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);

/**
 * Sarvam's real-time endpoint takes at most 30 s per recording, so a longer answer is recorded
 * in pieces: each piece ends at the first pause after SEGMENT_MIN_SECONDS (or, without a pause,
 * at SEGMENT_MAX_SECONDS) and the next starts at once on the same microphone stream. Pieces are
 * transcribed while the learner keeps speaking and joined in order. A summary used to stop dead
 * at 28 s (about 270 characters; tester, 7 Oct 2026).
 */
export const SEGMENT_MIN_SECONDS = 18;
export const SEGMENT_MAX_SECONDS = 27;
/** The whole answer; the message box takes 4,000 characters, about five minutes of speech. */
export const MAX_RECORD_SECONDS = 300;
const SILENCE_RMS = 0.015;
const SILENCE_MS = 350;

/**
 * Browsers record WebM/Opus or MP4; Sarvam recommends 16 kHz mono 16-bit WAV
 * and rejects some browser containers. Decode and resample here, so what
 * leaves the browser is always the recommended format. Returns null when the
 * recording holds no audible length.
 */
async function toWav16kMono(blob: Blob): Promise<Blob | null> {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  let decoded: AudioBuffer;
  try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close?.(); }
  if (decoded.duration < 0.3) return null;
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(Math.min(decoded.duration, 30) * rate), rate);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

export function useVoice(sessionId: string, caps: VoiceCaps, onDraft: (text: string, meta: VoiceMeta | null) => void) {
  const [consent, setConsent] = useState(caps.consent);
  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [readAloud, setReadAloud] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const stopRecording = useRef<(() => void) | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const supported = caps.recognition === 'server'
    ? typeof window !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'
    : !!browserRecognition();

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.abort(); stopRecording.current?.(); window.speechSynthesis?.cancel(); }, []);

  const grant = async (granted: boolean) => {
    setError('');
    try { await api('PUT', 'voice/consent', { granted }); setConsent(granted); }
    catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not save your choice.'); }
  };

  const start = async () => {
    setError('');
    window.speechSynthesis?.cancel(); audio.current?.pause();   // don't let the customer's voice be transcribed
    if (caps.recognition === 'browser') {
      const R = browserRecognition();
      if (!R) { setError('This browser cannot turn speech into text. Use Chrome, Edge or Safari, or type instead.'); return; }
      // Browsers end continuous recognition on their own (silence, time); until the learner
      // presses Stop, start again and keep what was already heard.
      let committed = ''; let finalText = ''; let userStopped = false; const confs: number[] = [];
      const began = Date.now();
      const run = () => {
        const r = new R();
        r.lang = caps.language; r.continuous = true; r.interimResults = true;
        r.onresult = (e: any) => {
          let interim = ''; finalText = '';
          for (let i = 0; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) { finalText += res[0].transcript; if (res[0].confidence > 0) confs.push(res[0].confidence); }
            else interim += res[0].transcript;
          }
          onDraft(`${committed} ${finalText}${interim}`.trim(), null);
        };
        r.onerror = (e: any) => { if (e?.error === 'no-speech' && committed) return; setError(e?.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser, or type instead.' : e?.error === 'no-speech' ? 'We did not hear anything. Try again.' : 'Could not hear you clearly. Try again, or type.'); };
        r.onend = () => {
          committed = `${committed} ${finalText}`.trim(); finalText = '';
          if (!userStopped && Date.now() - began < MAX_RECORD_SECONDS * 1000) { try { run(); return; } catch { /* fall through and finish */ } }
          setListening(false);
          const c = confs.filter((x) => x > 0);
          if (committed) onDraft(committed, { mode: 'voice', asr_provider: 'browser:webspeech', asr_text: committed, asr_confidence: c.length ? Math.round((c.reduce((a, x) => a + x, 0) / c.length) * 1000) / 1000 : null });
        };
        rec.current = r; r.start();
      };
      stopRecording.current = () => { userStopped = true; rec.current?.stop(); };
      run(); setListening(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Live preview: Sarvam only transcribes finished pieces, so while the learner speaks the
      // browser's own recogniser shows words as they come. Sarvam's transcript replaces it on
      // Stop; if a piece fails, the preview is kept (labelled as the browser's).
      // Desktop only: on phones the browser recogniser can take the microphone from the recorder.
      const preview = startPreview((text) => onDraft(text, null));
      // Pause detection on the same stream, to cut pieces between words rather than inside one.
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const actx: AudioContext | null = Ctx ? new Ctx() : null;
      const analyser = actx?.createAnalyser() ?? null;
      if (actx && analyser) { analyser.fftSize = 1024; actx.createMediaStreamSource(stream).connect(analyser); }
      const samples = new Float32Array(1024);
      const quiet = () => {
        if (!analyser) return false;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0; for (const v of samples) sum += v * v;
        return Math.sqrt(sum / samples.length) < SILENCE_RMS;
      };
      const pieces: Promise<string | null>[] = [];   // transcript per piece, in order; null = failed
      let finishing = false;
      let providerName = 'sarvam';   // the server names the exact model in each response
      const transcribePiece = async (blob: Blob): Promise<string | null> => {
        let wav: Blob | null = blob;
        try { wav = await toWav16kMono(blob); } catch { /* browser cannot decode its own recording: send it as recorded */ }
        if (!wav) return '';   // silence
        const f = new FormData(); f.append('audio', wav, wav === blob ? 'answer.webm' : 'answer.wav');
        try {
          const res = await fetch(`/v1/sessions/${sessionId}/transcribe`, { method: 'POST', body: f });
          const data = await res.json();
          if (res.ok && data.asr_provider) providerName = String(data.asr_provider);
          return res.ok ? String(data.transcript ?? '').trim() : null;
        } catch { return null; }
      };
      let current: MediaRecorder | null = null;
      let pieceStart = Date.now();
      const startPiece = () => {
        const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
        mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const index = pieces.length;
        let resolve!: (t: string | null) => void;
        pieces.push(new Promise((r) => { resolve = r; }));
        mr.onstop = () => {
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          transcribePiece(blob).then((t) => {
            resolve(t);
            // Without a live preview (phones), show each piece as soon as it is transcribed.
            if (!preview && !finishing) Promise.all(pieces.slice(0, index + 1)).then((ts) => onDraft(ts.filter(Boolean).join(' '), null));
          });
          if (!finishing) startPiece(); else finish();
        };
        current = mr; pieceStart = Date.now(); mr.start();
      };
      let quietSince: number | null = null;
      const finish = async () => {
        if (timer.current) clearInterval(timer.current); setSecondsLeft(null);
        stream.getTracks().forEach((t) => t.stop()); actx?.close?.();
        setListening(false); setWorking(true);
        const heardByBrowser = preview?.stop() ?? '';
        try {
          const texts = await Promise.all(pieces);
          const failed = texts.some((t) => t === null);
          const heard = texts.filter(Boolean).join(' ').trim();
          if (!failed && heard) onDraft(heard, { mode: 'voice', asr_provider: providerName, asr_text: heard, asr_confidence: null });
          else if (heardByBrowser) {
            onDraft(heardByBrowser, { mode: 'voice', asr_provider: 'browser:webspeech', asr_text: heardByBrowser, asr_confidence: null });
            setError(`${failed ? 'Part of the accurate transcript failed.' : 'The accurate transcript came back empty.'} Showing the browser's version instead; check it carefully.`);
          } else if (heard) {
            onDraft(heard, { mode: 'voice', asr_provider: providerName, asr_text: heard, asr_confidence: null });
            setError('Part of what you said could not be transcribed. Check the text, and type anything missing.');
          } else setError(failed ? 'Could not transcribe. Try again, or type.' : 'We did not hear anything. Try again.');
        } finally { setWorking(false); }
      };
      stopRecording.current = () => { if (finishing) return; finishing = true; if (current?.state === 'recording') current.stop(); else finish(); };
      startPiece(); setListening(true);
      const began = Date.now();
      timer.current = setInterval(() => {
        const left = MAX_RECORD_SECONDS - Math.floor((Date.now() - began) / 1000);
        setSecondsLeft(left <= 30 ? Math.max(0, left) : null);
        if (left <= 0) { stopRecording.current?.(); return; }
        // Roll over to a new piece at a pause, or before Sarvam's 30-second limit.
        const age = (Date.now() - pieceStart) / 1000;
        if (current?.state !== 'recording' || finishing) return;
        if (quiet()) quietSince ??= Date.now(); else quietSince = null;
        if (age >= SEGMENT_MAX_SECONDS || (age >= SEGMENT_MIN_SECONDS && quietSince !== null && Date.now() - quietSince >= SILENCE_MS)) { quietSince = null; current.stop(); }
      }, 100);
    } catch { setError('Microphone access was blocked. Allow it in the browser, or type instead.'); }
  };
  const stop = () => { if (stopRecording.current) { stopRecording.current(); stopRecording.current = null; } else rec.current?.stop(); };

  /** Browser recogniser as a live preview next to the server recording; null when unavailable. */
  function startPreview(show: (text: string) => void): { stop: () => string } | null {
    const R = browserRecognition();
    const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator as any).userAgentData?.mobile;
    if (!R || phone) return null;
    // Browsers end continuous recognition on their own after a while; a long answer restarts it
    // and keeps what was already heard.
    let committed = ''; let finals = ''; let stopped = false; let r: Recognition;
    const run = () => {
      r = new R();
      r.lang = caps.language; r.continuous = true; r.interimResults = true;
      r.onresult = (e: any) => {
        let interim = ''; finals = '';
        for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) finals += x[0].transcript; else interim += x[0].transcript; }
        if (!stopped) show(`${committed} ${finals}${interim}`.trim());
      };
      r.onerror = () => { /* preview only: the recording and Sarvam carry on regardless */ };
      r.onend = () => { committed = `${committed} ${finals}`.trim(); finals = ''; if (!stopped) { try { run(); } catch { setPreviewing(false); } } else setPreviewing(false); };
      r.start(); rec.current = r;
    };
    try { run(); setPreviewing(true); } catch { return null; }
    return { stop: () => { stopped = true; try { r.stop(); } catch { /* already stopped */ } setPreviewing(false); return `${committed} ${finals}`.trim(); } };
  }

  /** Read a committed customer turn aloud. */
  const say = async (turnId: string, text: string) => {
    if (!readAloud) return;
    if (caps.speech === 'server') {
      try {
        const r = await api('POST', `sessions/${sessionId}/speech`, { turn_id: turnId });
        audio.current?.pause();
        audio.current = new Audio(`data:audio/wav;base64,${r.data.audio_base64}`);
        await audio.current.play();
        return;
      } catch { /* fall back to the browser voice */ }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text); u.lang = caps.language; u.rate = 0.98;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    }
  };

  return { consent, grant, supported, listening, working, error, start, stop, readAloud, setReadAloud, say, secondsLeft, previewing };
}

export function VoiceConsent({ notice, onAllow, onDecline }: { notice: string; onAllow: () => void; onDecline: () => void }) {
  return <div className="note mb small" role="region" aria-label="Voice practice consent">
    <strong>Practise by speaking?</strong> {notice}
    <div className="btnrow mt"><button type="button" className="btn btn-sm btn-primary" onClick={onAllow}>Allow voice</button><button type="button" className="btn btn-sm" onClick={onDecline}>Not now</button></div>
  </div>;
}
