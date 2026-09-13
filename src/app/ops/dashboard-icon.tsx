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
};
export function Icon({name,style}:{name:string;style?:CSSProperties}) {return <svg style={style} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.file}/></svg>;}
