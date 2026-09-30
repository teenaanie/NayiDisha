import Link from 'next/link';
import {scopePage} from '@/lib/auth';
import {sql} from '@/lib/db';
import {fmtDateTime} from '@/lib/clock';
import {Pill} from '../../ui';
import {EmptyState} from '../../workspace-components';
import {costUsd,USD_INR,type Metered} from '@/modules/ai-usage/prices';
export const dynamic='force-dynamic';

const RANGES={today:{label:'Today',days:0},'7d':{label:'Last 7 days',days:7},'30d':{label:'Last 30 days',days:30}} as const;
type Range=keyof typeof RANGES;
const FEATURES:Record<string,string>={
 'practice.customer':'Sales practice — AI customer','practice.evaluator':'Sales practice — scoring','practice.translate':'Sales practice — translation',
 'practice.transcribe':'Sales practice — voice to text','practice.read_aloud':'Sales practice — read aloud',
 'voice.interpret':'Voice registration — understanding answers','script.score':'Role script — rubric scoring',
 'roleplay.roleplay':'Practice coach — customer replies','roleplay.evaluate':'Practice coach — assessment','roleplay.coach':'Practice coach — coaching',
 'roleplay.classify':'Practice coach — question understanding','roleplay.transcribe':'Practice coach — voice to text','roleplay.read_aloud':'Practice coach — read aloud',
};
const int=(n:number)=>new Intl.NumberFormat('en-IN').format(Math.round(n));
const usd=(n:number)=>'$'+(n<1?n.toFixed(4):n.toFixed(2));
const inr=(n:number)=>'₹'+new Intl.NumberFormat('en-IN',{maximumFractionDigits:n*USD_INR<10?2:0}).format(n*USD_INR);

interface Row extends Metered {day:string;provider:string;model:string;feature:string;calls:number;failed:number}
interface Group extends Metered {key:string;label:string;calls:number;failed:number;cost:number;unpriced:number}

function group(rows:Row[],key:(r:Row)=>string,label:(k:string)=>string=k=>k):Group[]{
 const out=new Map<string,Group>();
 for(const r of rows){
  const k=key(r);const g=out.get(k)??{key:k,label:label(k),calls:0,failed:0,cost:0,unpriced:0,input_tokens:0,cached_tokens:0,output_tokens:0,characters:0,audio_seconds:0};
  g.calls+=r.calls;g.failed+=r.failed;g.input_tokens+=r.input_tokens;g.cached_tokens+=r.cached_tokens;g.output_tokens+=r.output_tokens;g.characters+=r.characters;g.audio_seconds+=r.audio_seconds;
  const c=costUsd(r.model,r);if(c===null)g.unpriced+=r.calls-r.failed;else g.cost+=c;
  out.set(k,g);
 }
 return [...out.values()].sort((a,b)=>b.cost-a.cost||b.calls-a.calls);
}

/**
 * Token meter: what the platform's AI providers are costing, by feature and by
 * model. Rows come from app.ai_usage (one per call); cost is priced on read
 * from src/modules/ai-usage/prices.ts, so models without a price show as such.
 */
export default async function AiUsage({searchParams}:{searchParams:Promise<{range?:string}>}){
 await scopePage('ops');
 const {range:raw}=await searchParams;const range:Range=raw&&raw in RANGES?raw as Range:'7d';
 // "Today" is the India calendar day; the others are rolling windows ending now.
 const since=RANGES[range].days===0?sql`date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`:sql`now() - make_interval(days => ${RANGES[range].days})`;
 const [rows,recent]=await Promise.all([
  sql<Row[]>`SELECT to_char(at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day, provider, model, feature,
    count(*)::int AS calls, (count(*) FILTER (WHERE NOT ok))::int AS failed,
    sum(input_tokens)::int AS input_tokens, sum(cached_tokens)::int AS cached_tokens, sum(output_tokens)::int AS output_tokens,
    sum(characters)::int AS characters, COALESCE(sum(audio_seconds),0)::float AS audio_seconds
   FROM app.ai_usage WHERE at >= ${since} GROUP BY 1,2,3,4`,
  sql<any[]>`SELECT at, provider, model, feature, input_tokens, cached_tokens, output_tokens, characters, audio_seconds::float AS audio_seconds, ok, latency_ms
   FROM app.ai_usage ORDER BY at DESC LIMIT 25`,
 ]);
 const [total]=group(rows,()=>'all');
 const byFeature=group(rows,r=>r.feature,k=>FEATURES[k]??k);
 const byModel=group(rows,r=>r.provider+' · '+r.model);
 const byDay=group(rows,r=>r.day).sort((a,b)=>a.key.localeCompare(b.key));
 const peak=Math.max(...byDay.map(d=>d.cost),0);
 const tokens=(g:Group)=>g.input_tokens+g.cached_tokens+g.output_tokens;
 const costCell=(g:Group)=><td className="num">{g.cost>0||!g.unpriced?<>{usd(g.cost)} <span className="muted small">{inr(g.cost)}</span></>:null}{g.unpriced>0&&<> <Pill tone="warn">{g.unpriced} unpriced</Pill></>}</td>;

 return <main className="page">
  <div className="page-head"><div className="nd-section-kicker">Platform costs</div><h1>AI usage</h1><p>Tokens and cost of every call NayiDisha makes to an AI provider: Claude, Gemini, Sarvam and the practice-coach model. Rule-based fallbacks and the mock provider are free and not counted.</p></div>
  <div className="tags mb" role="group" aria-label="Period">{(Object.keys(RANGES) as Range[]).map(k=><Link key={k} href={`/ops/ai-usage?range=${k}`} className={`btn btn-sm${k===range?' btn-primary':''}`} aria-current={k===range?'page':undefined}>{RANGES[k].label}</Link>)}</div>
  {!total?<section className="card"><div className="card-body"><EmptyState title="No AI calls in this period" description="Calls appear here as soon as a configured provider (ANTHROPIC_API_KEY, GEMINI_API_KEY, SARVAM_API_KEY or RP_PROVIDER) is used."/></div></section>:<>
  <div className="tilegrid mb">
   <div className="stat"><div className="k">Estimated cost</div><div className="v">{usd(total.cost)}</div><div className="d">{inr(total.cost)} at ₹{USD_INR} per dollar{total.unpriced>0&&<> · {int(total.unpriced)} calls have no price</>}</div></div>
   <div className="stat"><div className="k">Tokens</div><div className="v">{int(tokens(total))}</div><div className="d">{int(total.input_tokens)} in · {int(total.cached_tokens)} cached · {int(total.output_tokens)} out</div></div>
   <div className="stat"><div className="k">AI calls</div><div className="v">{int(total.calls)}</div><div className="d">{total.failed?`${int(total.failed)} failed`:'none failed'}{total.characters>0&&<> · {int(total.characters)} characters</>}{total.audio_seconds>0&&<> · {(total.audio_seconds/60).toFixed(1)} audio min</>}</div></div>
  </div>
  {total.unpriced>0&&<div className="note mb">Some models have no price yet, so the total is an undercount. Add them to <code>src/modules/ai-usage/prices.ts</code> or the <code>AI_PRICES</code> setting; past calls are re-priced automatically.</div>}
  {byDay.length>1&&<section className="card mb"><div className="card-head"><h2>Cost by day</h2></div><div className="card-body"><div className="bars">
   {byDay.map(d=><div className="bar" key={d.key}><span>{new Date(d.key+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><span className="track"><span className="fill" style={{width:(peak?d.cost/peak*100:0)+'%'}}/></span><span className="val">{d.cost===0&&d.unpriced?'no price':usd(d.cost)}</span></div>)}
  </div></div></section>}
  <section className="card mb"><div className="card-head"><h2>By feature</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>Feature</th><th className="num">Calls</th><th className="num">Tokens in</th><th className="num">Tokens out</th><th className="num">Cost</th></tr></thead>
   <tbody>{byFeature.map(g=><tr key={g.key}><td>{g.label}{g.failed>0&&<> <Pill tone="bad">{g.failed} failed</Pill></>}</td><td className="num">{int(g.calls)}</td><td className="num">{int(g.input_tokens+g.cached_tokens)}</td><td className="num">{int(g.output_tokens)}</td>{costCell(g)}</tr>)}</tbody>
  </table></div></div></section>
  <section className="card mb"><div className="card-head"><h2>By model</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>Provider · model</th><th className="num">Calls</th><th className="num">Tokens</th><th className="num">Characters</th><th className="num">Audio min</th><th className="num">Cost</th></tr></thead>
   <tbody>{byModel.map(g=><tr key={g.key}><td>{g.label}</td><td className="num">{int(g.calls)}</td><td className="num">{int(tokens(g))}</td><td className="num">{g.characters?int(g.characters):'—'}</td><td className="num">{g.audio_seconds?(g.audio_seconds/60).toFixed(1):'—'}</td>{costCell(g)}</tr>)}</tbody>
  </table></div></div></section>
  </>}
  {recent.length>0&&<section className="card"><div className="card-head"><h2>Latest calls</h2></div><div className="card-body tight"><div className="tblwrap"><table>
   <thead><tr><th>When</th><th>Feature</th><th>Model</th><th className="num">In / out</th><th className="num">Cost</th><th className="num">Time</th></tr></thead>
   <tbody>{recent.map((r:any,i:number)=>{const c=costUsd(r.model,{...r,audio_seconds:r.audio_seconds??0});return <tr key={i}>
    <td className="small">{fmtDateTime(r.at)}</td><td>{FEATURES[r.feature]??r.feature}{!r.ok&&<> <Pill tone="bad">failed</Pill></>}</td><td className="small">{r.model}</td>
    <td className="num">{r.characters?`${int(r.characters)} chars`:r.audio_seconds?`${r.audio_seconds}s audio`:`${int(r.input_tokens+r.cached_tokens)} / ${int(r.output_tokens)}`}</td>
    <td className="num">{c===null?'—':usd(c)}</td><td className="num small">{r.latency_ms!=null?`${(r.latency_ms/1000).toFixed(1)}s`:'—'}</td></tr>;})}</tbody>
  </table></div></div></section>}
 </main>;
}
