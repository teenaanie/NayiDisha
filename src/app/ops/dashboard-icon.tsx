import type {CSSProperties} from 'react';
const paths: Record<string,string> = {
 home:'m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9', users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 building:'M5 21V3h14v18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M9 15h1 M14 15h1 M10 21v-3h4v3',
 job:'M8 7V3h8v4 M3 7h18v14H3z M3 12q9 5 18 0 M12 12v4',
 file:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8',
 shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z m-5 10 3 3 5-6',
 link:'m10 13 4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
 heart:'M20 4a5 5 0 0 0-8 2 5 5 0 0 0-8-2c-6 5 1 11 8 16 7-5 14-11 8-16',
 spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
 clock:'M7 2h10 M7 22h10 M7 2v5l10 10v5 M17 2v5L7 17v5',
 lock:'M6 10V7a6 6 0 0 1 12 0v3 M4 10h16v12H4z',
 chart:'M4 21V13h3v8 M11 21V3h3v18 M18 21V8h3v13',
 alert:'m12 2 10 19H2z M12 8v6 M12 17v1',
 settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
 search:'M19 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M16 16l6 6',
 calendar:'M3 5h18v17H3z M7 2v6 M17 2v6 M3 11h18',
 bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 bolt:'M13 2 4 14h7l-1 8 9-12h-7z',
 chevron:'m9 5 7 7-7 7',
};
export function Icon({name,style}:{name:string;style?:CSSProperties}) {return <svg style={style} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.file}/></svg>;}

/** The sunrise over Pune's hills that gives the dashboard its "new day" framing. Decorative only. */
export function SunriseArt(){
 const rays=[-74,-56,-38,-20,-2,16,34,52,70];
 return <svg className="nd-hero-art" width="1200" height="200" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
   <linearGradient id="nd-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fdf4e2"/><stop offset="1" stopColor="#fbf8f1"/></linearGradient>
   <linearGradient id="nd-hill-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d5e6da"/><stop offset="1" stopColor="#e9f1ea"/></linearGradient>
   <linearGradient id="nd-hill-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a9cfb8"/><stop offset="1" stopColor="#cbe2d3"/></linearGradient>
   <radialGradient id="nd-glow"><stop offset="0" stopColor="#f2bf62" stopOpacity=".45"/><stop offset="1" stopColor="#f2bf62" stopOpacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="200" fill="url(#nd-sky)"/>
  <circle cx="760" cy="88" r="110" fill="url(#nd-glow)"/>
  <g stroke="#e6b45c" strokeWidth="3" strokeLinecap="round" opacity=".7">
   {rays.map((a)=>{const r=(a*Math.PI)/180;return <line key={a} x1={760+Math.sin(r)*46} y1={88-Math.cos(r)*46} x2={760+Math.sin(r)*78} y2={88-Math.cos(r)*78}/>;})}
  </g>
  <circle cx="760" cy="88" r="31" fill="#efb954"/>
  <path d="M0 132q120-46 250-14t250-30 260 26 440-34v120H0z" fill="url(#nd-hill-far)"/>
  <path d="M0 166q150-36 320-6t280-20 600 24v36H0z" fill="url(#nd-hill-near)"/>
  <path d="M470 200q70-52 168-66t132-42" fill="none" stroke="#fbf8f1" strokeWidth="15" strokeLinecap="round" opacity=".9"/>
  <path d="M470 200q70-52 168-66t132-42" fill="none" stroke="#e6b45c" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="8 13" opacity=".85"/>
 </svg>;
}

/** The sprouting seedling in the sidebar footer. Decorative only. */
export function SeedlingArt(){
 return <svg className="nd-seedling" width="58" height="44" viewBox="0 0 64 48" aria-hidden="true">
  <path d="M32 46V24" fill="none" stroke="#2f7d5c" strokeWidth="2.4" strokeLinecap="round"/>
  <path d="M32 30c-12 0-18-6-19-15 10-1 18 4 19 15z" fill="#8fc9ac"/>
  <path d="M32 26c10-1 15-6 16-14-9-1-15 4-16 14z" fill="#2f7d5c"/>
  <path d="M12 46h40" fill="none" stroke="#cfe0d4" strokeWidth="2.4" strokeLinecap="round"/>
 </svg>;
}
