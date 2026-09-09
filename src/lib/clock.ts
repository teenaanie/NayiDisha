import { sql } from './db';

/**
 * Deterministic demo clock (§21.2).
 *
 * Every timestamp the domain writes comes from here, never from Date.now().
 * That is what makes the 72-hour reward hold, the 72-hour replacement window,
 * the 30-day attribution window and job expiry demonstrable in a 20-minute
 * demo instead of theoretical.
 *
 * Operations can advance the clock from the ops console; reset restores it to
 * the canonical seed instant.
 */
export const SEED_INSTANT = new Date('2026-10-05T10:00:00+05:30');

export async function now(conn=sql): Promise<Date> {
  const [row] = await conn<{ now_at: Date }[]>`
    SELECT now_at FROM app.demo_clock WHERE id = 1
  `;
  return row?.now_at ?? SEED_INSTANT;
}

export async function advanceClock(hours: number): Promise<Date> {
  const [row] = await sql<{ now_at: Date }[]>`
    UPDATE app.demo_clock
       SET now_at = now_at + make_interval(hours => ${hours})
     WHERE id = 1
     RETURNING now_at
  `;
  return row.now_at;
}

export async function setClock(at: Date): Promise<void> {
  await sql`UPDATE app.demo_clock SET now_at = ${at} WHERE id = 1`;
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600_000);
}

export function addDays(d: Date, days: number): Date {
  return addHours(d, days * 24);
}

/** Indian financial year label for s.194H cumulative tracking: Apr–Mar. */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed; April = 3
  return m >= 3 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}`
                : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
