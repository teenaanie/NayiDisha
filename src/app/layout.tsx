import './globals.css';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import { fmtDateTime } from '@/lib/clock';
import { RoleBar } from './role-bar';

export const metadata: Metadata = {
  title: 'Frontline Hiring — Pune BFSI Prototype',
  description: 'PRD v1.3 prototype. Demo data only.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let clockLabel = '—';
  let demoMode = true;
  try {
    const [row] = await sql<{ now_at: Date; demo_mode: boolean }[]>`
      SELECT now_at, demo_mode FROM app.demo_clock WHERE id = 1
    `;
    if (row) { clockLabel = fmtDateTime(row.now_at); demoMode = row.demo_mode; }
  } catch {
    clockLabel = 'database not reachable — run npm run db:reset';
  }

  return (
    <html lang="en">
      <body>
        {demoMode && (
          <div className="demo-banner">
            <span>⚠ Demo mode · all people and organisations are fictional · no live messaging, KYC or payouts</span>
            <span className="clock">Demo clock: {clockLabel} IST</span>
          </div>
        )}
        <RoleBar />
        {children}
      </body>
    </html>
  );
}
