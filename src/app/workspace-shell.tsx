'use client';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {Icon,SeedlingArt} from './ops/dashboard-icon';
import {OpsShell} from './ops/shell';
import {EMPLOYER_TABS,PARTNER_TABS,FINANCE_TABS,CANDIDATE_TABS} from './subnav';
const workspaces=[['/','Platform overview','home'],['/ops','Operations','settings'],['/employer','Employer','building'],['/partner','Partner','users'],['/finance','Finance','chart'],['/wa','Candidate journey','heart'],['/demo','Demo identities','users'],['/sign-in','Sign in / out','lock']];
const icons:Record<string,string>={'Dashboard':'home','My organisation':'building','Jobs':'job','Interviews & onboarding':'calendar','Credit requests':'file','Billing & credits':'lock','Outcomes':'chart','QR sites':'link','My candidates':'users','Job alerts':'bell','Rewards':'spark','Conduct rules':'shield','Partner balances':'users','Payout batches':'file','Reward ledger':'chart','My profile':'users','My applications':'file','WhatsApp journey':'heart','Alerts & messages':'bell','Profile & preferences':'settings','My data':'shield','Job suggestions':'spark'};
export function WorkspaceShell({children,role}:{children:React.ReactNode;role:string|null}){
 const path=usePathname();const params=useSearchParams();const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const searchRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{setOpen(false);setQuery('');},[path]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(searchRef.current&&!searchRef.current.contains(event.target as Node))setQuery('');};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 if(path.startsWith('/ops'))return <OpsShell role={role||'OPERATIONS'}>{children}</OpsShell>;
 const section=path.split('/')[1];
 const tabs=section==='employer'?EMPLOYER_TABS:section==='partner'?PARTNER_TABS:section==='finance'?FINANCE_TABS:section==='wa'?[...CANDIDATE_TABS,{href:'/wa/suggestions',label:'Job suggestions'}]:null;
 const workspace=section==='employer'?'Employer':section==='partner'?'Partner':section==='finance'?'Finance':section==='wa'?'Candidate':'Platform';
 const home=tabs?(section==='wa'?'/wa':'/'+section):'/';
 const links=tabs?tabs.map(t=>[t.href,t.label,icons[t.label]||'file']):workspaces;
 const contextual=(href:string)=>{const key=section==='partner'?'p':section==='wa'?'c':null;const value=key?params.get(key):null;return value&&href.startsWith('/'+section)&&href!=='/wa'?href+'?'+key+'='+encodeURIComponent(value):href;};
 const matches=query.trim()?links.filter(([,label])=>label.toLowerCase().includes(query.trim().toLowerCase())):[];
 const active=(href:string)=>href===home?path===href:path===href||path.startsWith(href+'/')||(href==='/employer/jobs'&&(path.startsWith('/employer/job/')||path==='/employer/new-job'));
 const title=links.find(([href])=>active(href))?.[1]||'Workspace';
 const publicAccess=['sign-in','invite','endorse','j'].includes(section)||(section==='demo'&&!role);
 return <div className={`nd-shell nd-unified nd-${section||'overview'} ${publicAccess?'nd-public':''}`}>
  <a className="nd-skip" href="#workspace-content">Skip to content</a>
  <aside id="workspace-navigation" className={`nd-sidebar ${open?'is-open':''}`}>
   <Link href={contextual(home)} className="nd-brand"><span className="nd-sun">☀</span><strong>NayiDisha</strong><small>Jobs. Skills. Better Futures.</small></Link>
   <div className="nd-workspace-label">{workspace} workspace</div>
   <nav aria-label={`${workspace} navigation`}>{links.map(([href,label,icon])=><Link prefetch={false} href={contextual(href)} key={href} aria-current={active(href)?'page':undefined} onClick={()=>setOpen(false)}><Icon name={icon}/>{label}</Link>)}</nav>
   <div className="nd-help"><SeedlingArt/><strong>{workspace==='Candidate'?'Your next step starts here.':'Creating opportunities together.'}</strong><p>{workspace==='Candidate'?'Build your profile and discover opportunities. Always free for job seekers.':'Connect people with opportunity, one step at a time.'}</p><Link href={workspace==='Candidate'?'/wa':'/demo'} className="btn">{workspace==='Candidate'?'Continue your journey':'Open demo guide'} →</Link></div>
  </aside>
  <div className="nd-workspace">
   <header className="nd-topbar">
    <button className="btn nd-menu" aria-expanded={open} aria-controls="workspace-navigation" onClick={()=>setOpen(!open)}>{open?'Close menu':'Menu'}</button>
    <div ref={searchRef} className="nd-search"><Icon name="search"/><input aria-label={`Find a ${workspace.toLowerCase()} page`} placeholder={`Search ${workspace.toLowerCase()} workspace…`} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('');}}/>{query&&<div className="nd-search-results" role="region" aria-label="Page search results">{matches.length?matches.map(([href,label])=><Link href={contextual(href)} key={href} onClick={()=>{setQuery('');setOpen(false);}}>{label}<span>→</span></Link>):<p>No pages match “{query}”. Try a page name from the menu.</p>}</div>}</div>
    <details className="nd-account"><summary className="nd-profile" aria-label="Account and workspace menu"><span className="nd-avatar">{role?role[0]:'N'}</span><span><strong>{role?role==='ADMIN'?'Administrator':workspace:'Welcome'}</strong><small>{role?'Your NayiDisha account':'Find your next direction'}</small></span><span aria-hidden="true">⌄</span></summary><div className="nd-account-menu"><strong>Your workspace</strong>{role==='ADMIN'&&workspaces.slice(0,5).map(([href,label])=><Link href={href} key={href} onClick={e=>e.currentTarget.closest('details')?.removeAttribute('open')}>{label}</Link>)}<Link href="/demo">Demo identities</Link><Link href="/sign-in">Sign in / switch account</Link></div></details>
   </header>
   <div className="nd-breadcrumb"><Link href={contextual(home)}>{workspace}</Link><span>/</span><span>{title}</span><span className="nd-workspace-badge">Jobs. Skills. Better Futures.</span></div>
   <div id="workspace-content" tabIndex={-1}>{children}</div>
  </div>
 </div>;
}
