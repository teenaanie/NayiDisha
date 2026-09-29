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

/** Sarvam's real-time endpoint takes at most 30 s; stop a little before. */
export const MAX_RECORD_SECONDS = 28;

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
  const rec = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const supported = caps.recognition === 'server'
    ? typeof window !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'
    : !!browserRecognition();

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.abort(); recorder.current?.state === 'recording' && recorder.current.stop(); window.speechSynthesis?.cancel(); }, []);

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
      const r = new R();
      r.lang = caps.language; r.continuous = true; r.interimResults = true;
      let finalText = ''; const confs: number[] = [];
      r.onresult = (e: any) => {
        let interim = ''; finalText = '';
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) { finalText += res[0].transcript; if (res[0].confidence > 0) confs[i] = res[0].confidence; }
          else interim += res[0].transcript;
        }
        onDraft((finalText + interim).trim(), null);
      };
      r.onerror = (e: any) => { setError(e?.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser, or type instead.' : e?.error === 'no-speech' ? 'We did not hear anything. Try again.' : 'Could not hear you clearly. Try again, or type.'); };
      r.onend = () => {
        setListening(false);
        const heard = finalText.trim();
        const c = confs.filter((x) => x > 0);
        if (heard) onDraft(heard, { mode: 'voice', asr_provider: 'browser:webspeech', asr_text: heard, asr_confidence: c.length ? Math.round((c.reduce((a, x) => a + x, 0) / c.length) * 1000) / 1000 : null });
      };
      rec.current = r; r.start(); setListening(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setListening(false); setWorking(true);
        if (timer.current) clearInterval(timer.current); setSecondsLeft(null);
        try {
          const raw = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          let wav: Blob | null = raw;
          try { wav = await toWav16kMono(raw); } catch { /* browser cannot decode its own recording: send it as recorded */ }
          if (!wav) { setError('We did not hear anything. Try again.'); return; }
          const f = new FormData(); f.append('audio', wav, wav === raw ? 'answer.webm' : 'answer.wav');
          const res = await fetch(`/v1/sessions/${sessionId}/transcribe`, { method: 'POST', body: f });
          const data = await res.json();
          if (!res.ok) throw new ApiFailure(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Transcription failed.', !!data?.error?.retryable, {});
          if (data.transcript?.trim()) onDraft(data.transcript.trim(), { mode: 'voice', asr_provider: data.asr_provider, asr_text: data.transcript.trim(), asr_confidence: data.asr_confidence });
          else setError('We did not hear anything. Try again.');
        } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Could not transcribe. Try again, or type.'); }
        finally { setWorking(false); }
      };
      recorder.current = mr; mr.start(); setListening(true);
      const began = Date.now(); setSecondsLeft(MAX_RECORD_SECONDS);
      timer.current = setInterval(() => {
        const left = MAX_RECORD_SECONDS - Math.floor((Date.now() - began) / 1000);
        setSecondsLeft(Math.max(0, left));
        if (left <= 0 && mr.state === 'recording') mr.stop();
      }, 250);
    } catch { setError('Microphone access was blocked. Allow it in the browser, or type instead.'); }
  };
  const stop = () => { rec.current?.stop(); if (recorder.current?.state === 'recording') recorder.current.stop(); };

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

  return { consent, grant, supported, listening, working, error, start, stop, readAloud, setReadAloud, say, secondsLeft };
}

export function VoiceConsent({ notice, onAllow, onDecline }: { notice: string; onAllow: () => void; onDecline: () => void }) {
  return <div className="note mb small" role="region" aria-label="Voice practice consent">
    <strong>Practise by speaking?</strong> {notice}
    <div className="btnrow mt"><button type="button" className="btn btn-sm btn-primary" onClick={onAllow}>Allow voice</button><button type="button" className="btn btn-sm" onClick={onDecline}>Not now</button></div>
  </div>;
}
