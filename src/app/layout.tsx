import {readQuery} from '@/lib/read-query';
import './globals.css';
import {Suspense} from 'react';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import {WorkspaceShell} from './workspace-shell';
import {identity} from '@/lib/auth';
import './ops/operations.css';
import './workspace.css';
import './theme.css';

export const metadata: Metadata = {
  title: 'NayiDisha — Jobs. Skills. Better Futures.',
  description: 'PRD v1.3 prototype. Demo data only.',
};

export const dynamic = 'force-dynamic';

async function DemoBanner() {
  let clockLabel = '—';
  let demoMode = true;
  try {
    const [row] = await readQuery(sql<{ now_at: Date; demo_mode: boolean }[]>`
      SELECT now_at, demo_mode FROM app.demo_clock WHERE id = 1
    `);
    if (row) { clockLabel = fmtDateTime(row.now_at); demoMode = row.demo_mode; }
  } catch {
    clockLabel = 'clock unavailable';
  }

  return demoMode ? <div className="demo-banner"><span>Demo mode · fictional data · no live messaging or payouts</span><span className="clock">Demo clock: {clockLabel} IST</span></div> : null;
}
export default async function RootLayout({children}:{children:React.ReactNode}) {
  const viewer=await identity();
  return (
    <html lang="en" data-theme="light">
      <body className="nd-theme">
        <Suspense fallback={<div className="demo-banner">Demo mode · loading clock…</div>}><DemoBanner /></Suspense>
        <Suspense fallback={<main className="page">Opening your workspace…</main>}><WorkspaceShell role={viewer?.role||null}>{children}</WorkspaceShell></Suspense>
      </body>
    </html>
  );
}
