'use client';
import {useEffect,useRef,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {beginPractice,sendLine,finishPractice,allowPracticeVoice,transcribe,speakTurn} from './actions';

export function StartPractice({scenarioId,languages,retryOf,label='Start practice'}:{scenarioId:string;languages:{value:string;label:string}[];retryOf?:string;label?:string}){
 const router=useRouter();const [pending,start]=useTransition();const [error,setError]=useState('');
 return <form className="btnrow" action={f=>start(async()=>{setError('');const r=await beginPractice(scenarioId,String(f.get('language')),retryOf);if('error' in r&&r.error){setError(r.error);return;}if('sessionId' in r)router.push('/wa/practice/'+r.sessionId);})}>
  <label className="small">Language <select name="language" defaultValue="en">{languages.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
  <button className="btn btn-primary" disabled={pending}>{pending?'Starting…':label}</button>
  {error&&<p role="alert" className="small">{error}</p>}
 </form>;
}

type Line={seq:number;speaker:'LEARNER'|'CUSTOMER';text:string};
type Voice='sarvam'|'browser'|'none';

export function PracticeChat({sessionId,customerName,learnerRole,brief,focus,language,turns,startedAt,durationMin,maxTurns,voice,voiceConsent}:{
 sessionId:string;customerName:string;learnerRole:string;brief:string;focus:string|null;language:string;turns:Line[];
 startedAt:string;durationMin:number;maxTurns:number;voice:Voice;voiceConsent:boolean;
}){
 const router=useRouter();const [pending,start]=useTransition();
 const [lines,setLines]=useState<Line[]>(turns);const [draft,setDraft]=useState('');const [mode,setMode]=useState<'TEXT'|'VOICE'>('TEXT');
 const [error,setError]=useState('');const [finishing,setFinishing]=useState(false);
 const [consented,setConsented]=useState(voiceConsent);const [recording,setRecording]=useState(false);const [speak,setSpeak]=useState(voice!=='none');
 const [left,setLeft]=useState(()=>Math.max(0,new Date(startedAt).getTime()+durationMin*60000-Date.now()));
 const end=useRef<HTMLDivElement>(null);const recorder=useRef<MediaRecorder|null>(null);const chunks=useRef<Blob[]>([]);const recognition=useRef<any>(null);
 const learnerTurns=lines.filter(l=>l.speaker==='LEARNER').length;
 const tag=`${language}-IN`;

 useEffect(()=>{end.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[lines]);
 const finish=(timedOut=false)=>{if(finishing)return;setFinishing(true);start(async()=>{const r=await finishPractice(sessionId,timedOut);if('error' in r&&r.error){setError(r.error);setFinishing(false);return;}router.refresh();});};
 useEffect(()=>{const t=setInterval(()=>{const ms=new Date(startedAt).getTime()+durationMin*60000-Date.now();setLeft(Math.max(0,ms));if(ms<=0){clearInterval(t);finish(true);}},1000);return()=>clearInterval(t);// eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 const say=async(seq:number,text:string)=>{
  if(!speak)return;
  if(voice==='sarvam'){const r=await speakTurn(sessionId,seq);if(r.audio){new Audio('data:audio/wav;base64,'+r.audio).play().catch(()=>{});return;}}
  if('speechSynthesis' in window){const u=new SpeechSynthesisUtterance(text);u.lang=tag;u.rate=0.95;window.speechSynthesis.cancel();window.speechSynthesis.speak(u);}
 };
 const send=()=>{const text=draft.trim();if(!text||pending)return;setError('');
  const optimistic:Line={seq:-1,speaker:'LEARNER',text};setLines(l=>[...l,optimistic]);setDraft('');
  start(async()=>{const r=await sendLine(sessionId,text,mode,null);setMode('TEXT');
   if('error' in r&&r.error){setError(r.error);setLines(l=>l.filter(x=>x!==optimistic));setDraft(text);return;}
   if('ended' in r&&r.ended){router.refresh();return;}
   if('reply' in r&&r.reply){const seq=r.seq!;setLines(l=>[...l.filter(x=>x!==optimistic),{seq:seq-1,speaker:'LEARNER',text},{seq,speaker:'CUSTOMER',text:r.reply!}]);say(seq,r.reply);}
  });};

 const startRecording=async()=>{
  setError('');
  if(voice==='browser'){const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!SR){setError('This browser cannot listen. Please type instead.');return;}
   const rec=new SR();rec.lang=tag;rec.interimResults=true;rec.continuous=true;recognition.current=rec;
   rec.onresult=(e:any)=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setDraft(t);setMode('VOICE');};
   rec.onend=()=>setRecording(false);rec.onerror=()=>{setRecording(false);setError('Could not hear you. Please try again or type.');};
   rec.start();setRecording(true);return;}
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const rec=new MediaRecorder(stream);chunks.current=[];
   rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);};
   rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks.current,{type:rec.mimeType||'audio/webm'});const f=new FormData();f.append('audio',blob,'answer.webm');
    start(async()=>{const r=await transcribe(sessionId,f);if('error' in r&&r.error){setError(r.error);return;}if('transcript' in r&&r.transcript){setDraft(d=>(d?d+' ':'')+r.transcript);setMode('VOICE');}});};
   recorder.current=rec;rec.start();setRecording(true);
   setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
  }catch{setError('Microphone access was blocked. Please type instead.');}
 };
 const stopRecording=()=>{recorder.current?.state==='recording'&&recorder.current.stop();recognition.current?.stop();setRecording(false);};

 const mins=Math.floor(left/60000),secs=Math.floor(left/1000)%60;
 return <div className="grid g2">
  <section className="card practice-brief"><div className="card-head"><h2>Your brief</h2><span className={'practice-timer'+(left<120000?' low':'')} aria-live="off">{mins}:{String(secs).padStart(2,'0')} left</span></div>
   <div className="card-body">
    <p className="small muted">You are the {learnerRole}.</p><p>{brief}</p>
    {focus&&<div className="note mb"><strong>Focus for this retry:</strong> {focus}</div>}
    <p className="small muted">Turns used: {learnerTurns} of {maxTurns}. Understand the need before you explain any product. End the conversation when you are ready for feedback.</p>
    <div className="btnrow"><button className="btn" disabled={pending||finishing||learnerTurns===0} onClick={()=>finish(false)}>{finishing?'Scoring your conversation…':'End and get feedback'}</button>
     {voice!=='none'&&<label className="small"><input type="checkbox" checked={speak} onChange={e=>setSpeak(e.target.checked)}/> Read replies aloud</label>}</div>
   </div>
  </section>
  <section className="card"><div className="card-head"><h2>{customerName}</h2><span className="small muted">AI customer</span></div>
   <div className="card-body">
    <div className="wa-body practice-chat" aria-live="polite">
     {lines.map((l,i)=><div key={i} className={'wa-msg '+(l.speaker==='CUSTOMER'?'wa-in':'wa-out')}>{l.text}<div className="wa-meta">{l.speaker==='CUSTOMER'?customerName:'You'}</div></div>)}
     {pending&&!finishing&&<div className="wa-msg wa-in small muted" role="status">…</div>}
     <div ref={end}/>
    </div>
    {error&&<p role="alert" className="wa-flow-error">{error}</p>}
    {voice==='sarvam'&&!consented&&<div className="note mb small">To use your voice, your recording is sent to Sarvam AI to be transcribed. It is not stored. <button className="btn btn-sm" onClick={()=>start(async()=>{const r=await allowPracticeVoice();if('ok' in r)setConsented(true);else setError(r.error);})}>Allow voice</button></div>}
    <div className="practice-composer">
     <textarea aria-label="Your reply" value={draft} disabled={finishing} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type your question, or use the microphone"/>
     {voice!=='none'&&(voice==='browser'||consented)&&<button className="btn" type="button" disabled={finishing||(pending&&!recording)} aria-pressed={recording} onClick={recording?stopRecording:startRecording}>{recording?'■ Stop':'🎤'}</button>}
     <button className="btn btn-primary" disabled={pending||finishing||!draft.trim()} onClick={send}>Send</button>
    </div>
    {mode==='VOICE'&&<p className="small muted">Check the transcript, correct it if needed, then send.</p>}
   </div>
  </section>
 </div>;
}
