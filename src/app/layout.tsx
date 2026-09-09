import './globals.css';
import {Suspense} from 'react';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { RoleBar } from './role-bar';

export const metadata: Metadata = {
  title: 'Frontline Hiring — Pune BFSI Prototype',
  description: 'PRD v1.3 prototype. Demo data only.',
};

export const dynamic = 'force-dynamic';

async function DemoBanner() {
  let clockLabel = '—';
  let demoMode = true;
  try {
    const [row] = await sql<{ now_at: Date; demo_mode: boolean }[]>`
      SELECT now_at, demo_mode FROM app.demo_clock WHERE id = 1
    `;
    if (row) { clockLabel = fmtDateTime(row.now_at); demoMode = row.demo_mode; }
  } catch {
    clockLabel = 'clock unavailable';
  }

  return demoMode ? <div className="demo-banner"><span>Demo mode · fictional data · no live messaging or payouts</span><span className="clock">Demo clock: {clockLabel} IST</span></div> : null;
}
export default function RootLayout({children}:{children:React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<div className="demo-banner">Demo mode · loading clock…</div>}><DemoBanner /></Suspense>
        <RoleBar />
        {children}
      </body>
    </html>
  );
}
