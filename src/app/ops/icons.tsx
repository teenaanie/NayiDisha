import type {ReactNode} from 'react';

/**
 * Minimal stroke-style icon set for the Operations console.
 *
 * Hand-drawn rather than pulled from an icon package: this is the only surface
 * that needs icons, the set is small and fixed, and it keeps the dependency
 * list (and bundle) where it is. Everything inherits `currentColor`, so icons
 * pick up whatever text colour their container already uses in either theme.
 */
const SHAPES: Record<string, ReactNode> = {
  dashboard: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></>,
  employers: <><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 21v-4h6v4"/><path d="M9 7h1M9 11h1M14 7h1M14 11h1"/></>,
  partners: <><path d="M9.5 13.5L7 16a2.8 2.8 0 004 4l2.5-2.5"/><path d="M14.5 10.5L17 8a2.8 2.8 0 00-4-4l-2.5 2.5"/><path d="M9 15l6-6"/></>,
  candidates: <><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6"/></>,
  jobs: <><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8.5 8V6a2 2 0 012-2h3a2 2 0 012 2v2"/><path d="M3 13h18"/></>,
  matches: <><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.6 2.6 4.6-5.2"/></>,
  applications: <><path d="M6.5 3h8l3.5 3.5V21h-11z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/></>,
  referrals: <><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8 11l8-3.8M8 13l8 3.8"/></>,
  exceptions: <><path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.6h.01"/></>,
  credits: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10.5h18"/><path d="M7 15h3"/></>,
  manage: <><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></>,
  configurations: <><path d="M4 7h9M4 12h16M4 17h6"/><circle cx="17" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></>,
  search: <><circle cx="11" cy="11" r="6.8"/><path d="M20.5 20.5L16 16"/></>,
  bell: <><path d="M6.2 9.5a5.8 5.8 0 0111.6 0c0 4.6 1.9 5.7 1.9 5.7H4.3s1.9-1.1 1.9-5.7z"/><path d="M10 19a2 2 0 004 0"/></>,
  chevron: <path d="M9.5 6l6 6-6 6"/>,
  shield: <><path d="M12 3.2l7.2 2.8v5.6c0 4.8-3 7.6-7.2 9-4.2-1.4-7.2-4.2-7.2-9V6z"/><path d="M9 12l2.2 2.2 4-4.4"/></>,
  spark: <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/>,
  hourglass: <><path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.5 4 5.5 4 8.5s-4 4-4 8.5"/><path d="M16 3.5c0 4.5-4 5.5-4 8.5s4 4 4 8.5"/></>,
  heart: <path d="M12 20.5s-7-4.4-9-8.3A4.7 4.7 0 0112 6.4a4.7 4.7 0 019 5.8c-2 3.9-9 8.3-9 8.3z"/>,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.2 11V8.2a3.8 3.8 0 017.6 0V11"/></>,
  rupee: <><path d="M8 4.5h8M8 9h8M8 19.5L14 13"/><path d="M8 13h3.5a4.3 4.3 0 100-8.5"/></>,
  help: <><path d="M4 5.5h16v11H12l-5 4v-4H4z"/><path d="M10.2 9.4a1.9 1.9 0 113 1.6c-.7.4-1.2.9-1.2 1.6"/><path d="M12 14.6h.01"/></>,
  audit: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></>,
};

export function Icon({name, size = 18}: {name: keyof typeof SHAPES | string; size?: number}) {
  const shape = SHAPES[name] ?? SHAPES.chevron;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{display: 'block', flexShrink: 0}}>
      {shape}
    </svg>
  );
}
