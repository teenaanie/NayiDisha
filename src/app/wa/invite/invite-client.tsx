'use client';
import {useRef,useState,useTransition,Fragment} from 'react';
import {useRouter} from 'next/navigation';
import type {FlowScreen,FlowField,FlowLang} from '@/modules/registration/flow';
import {replyToInvite,submitRegistration} from './actions';

const CHIPS:Record<FlowLang,[string,string]>={en:['Yes, show me','No, thanks'],hi:['हाँ, दिखाइए','नहीं, धन्यवाद'],mr:['हो, दाखवा','नको, धन्यवाद']};
const UI:Record<FlowLang,Record<string,string>>={
 en:{open:'Open form',next:'Continue',back:'Back',submit:'Submit',sending:'Sending…',step:'Step',of:'of',choose:'Choose…',changed:'Changed your mind?',managed:'Managed by NayiDisha · WhatsApp Flow'},
 hi:{open:'फ़ॉर्म खोलें',next:'आगे',back:'पीछे',submit:'भेजें',sending:'भेज रहे हैं…',step:'चरण',of:'में से',choose:'चुनें…',changed:'मन बदल गया?',managed:'NayiDisha द्वारा · WhatsApp Flow'},
 mr:{open:'फॉर्म उघडा',next:'पुढे',back:'मागे',submit:'पाठवा',sending:'पाठवत आहे…',step:'टप्पा',of:'पैकी',choose:'निवडा…',changed:'विचार बदलला?',managed:'NayiDisha द्वारे · WhatsApp Flow'},
};

/** Message text with any URL made tappable, as WhatsApp does. */
function Body({text}:{text:string}){
 return <>{text.split(/(https?:\/\/\S+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part}>{part}</a>:<Fragment key={i}>{part}</Fragment>)}</>;
}

function Field({f,lang,choose}:{f:FlowField;lang:FlowLang;choose:string}){
 const label=f.label[lang];
 if(f.kind==='optin')return <label className="wa-flow-optin"><input type="checkbox" name={f.name} required={f.required}/><span>{label}</span></label>;
 if(f.kind==='dropdown')return <label className="field">{label}<select name={f.name} required={f.required} defaultValue=""><option value="" disabled>{choose}</option>{f.options!.map(o=><option key={o.id} value={o.id}>{o.title[lang]}</option>)}</select></label>;
 if(f.kind==='checkboxes')return <fieldset className="field-group"><legend>{label}</legend>{f.options!.map(o=><label key={o.id}><input type="checkbox" name={f.name} value={o.id} defaultChecked={o.id===lang}/>{o.title[lang]}</label>)}</fieldset>;
 if(f.kind==='document')return <label className="field">{label}<input type="file" name={f.name} required={f.required} accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"/></label>;
 const type=f.kind==='email'?'email':f.kind==='date'?'date':f.kind==='number'?'number':'text';
 return <label className="field">{label}<input name={f.name} type={type} required={f.required} min={f.min} max={f.max} inputMode={f.name==='pin_code'?'numeric':undefined} pattern={f.name==='pin_code'?'[1-9][0-9]{5}':undefined} autoComplete={f.name==='full_name'?'name':f.name==='email'?'email':f.name==='date_of_birth'?'bday':undefined}/>{f.helper&&<span className="small muted">{f.helper[lang]}</span>}</label>;
}

export function InviteChat({token,status,language,thread,flow}:{token:string;status:string;language:FlowLang;thread:{direction:string;body:string;template:string|null;at:string}[];flow:FlowScreen[]}){
 const lang=(['en','hi','mr'].includes(language)?language:'en') as FlowLang;const t=UI[lang];
 const router=useRouter();const [pending,start]=useTransition();const [error,setError]=useState('');
 const [open,setOpen]=useState(false);const [screen,setScreen]=useState(0);const form=useRef<HTMLFormElement>(null);const sets=useRef<(HTMLFieldSetElement|null)[]>([]);
 const reply=(accepted:boolean)=>start(async()=>{setError('');const r=await replyToInvite(token,accepted,CHIPS[lang][accepted?0:1]);if(r.error)setError(r.error);else router.refresh();});
 // A fieldset never validates its own contents, so each field is asked in turn.
 const valid=()=>Array.from(sets.current[screen]?.elements??[]).every(el=>(el as HTMLInputElement).reportValidity?.()??true);
 const next=()=>{if(valid())setScreen(s=>s+1);};
 const submit=(f:FormData)=>start(async()=>{setError('');const r=await submitRegistration(token,f);if(r.error){setError(r.error);return;}setOpen(false);router.refresh();});
 const last=screen===flow.length-1;
 return <>
  {thread.map((m,i)=><div key={i} className={'wa-msg '+(m.direction==='OUTBOUND'?'wa-in':'wa-out')}><Body text={m.body}/><div className="wa-meta">{m.direction==='OUTBOUND'?'NayiDisha':'You · ✓✓'}</div></div>)}
  <div className="wa-msg wa-in wa-reply-panel" aria-busy={pending}>
   {error&&<p role="alert" className="wa-flow-error">{error}</p>}
   {pending&&!open&&<p role="status">NayiDisha is processing your reply…</p>}
   {(status==='SENT'||status==='DECLINED')&&<>{status==='DECLINED'&&<p className="small muted">{t.changed}</p>}<div className="btnrow">
    <button className="btn btn-primary" disabled={pending} onClick={()=>reply(true)}>{CHIPS[lang][0]}</button>
    {status==='SENT'&&<button className="btn" disabled={pending} onClick={()=>reply(false)}>{CHIPS[lang][1]}</button>}
   </div></>}
   {status==='ACCEPTED'&&!open&&<button className="btn btn-primary" onClick={()=>{setOpen(true);setScreen(0);}}>📋 {t.open}</button>}
   {status==='ACCEPTED'&&open&&<form ref={form} className="wa-flow" noValidate action={submit} aria-label="Registration form">
    <div className="wa-flow-head"><strong>{flow[screen].title[lang]}</strong><span className="small muted">{t.step} {screen+1} {t.of} {flow.length}</span></div>
    {flow.map((s,i)=><fieldset key={s.id} ref={el=>{sets.current[i]=el;}} hidden={i!==screen} className="wa-flow-screen">{s.fields.map(f=><Field key={f.name} f={f} lang={lang} choose={t.choose}/>)}</fieldset>)}
    <div className="btnrow">
     {screen>0&&<button type="button" className="btn" disabled={pending} onClick={()=>setScreen(s=>s-1)}>{t.back}</button>}
     {!last&&<button type="button" className="btn btn-primary" onClick={next}>{t.next}</button>}
     {last&&<button type="submit" className="btn btn-primary" disabled={pending} onClick={e=>{if(!valid())e.preventDefault();}}>{pending?t.sending:t.submit}</button>}
    </div>
    <p className="small muted">{t.managed}</p>
   </form>}
   {status==='FORM_SUBMITTED'&&<a className="btn btn-primary" href="/sign-in">Sign in with mobile + OTP</a>}
  </div>
 </>;
}
