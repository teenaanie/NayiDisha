/** Same shape as scripts/acceptance.ts: every check names the requirement it protects. */
export interface Check { id: string; name: string; ok: boolean; detail: string }
export const check = (id: string, name: string, ok: boolean, detail = ''): Check => { if (process.env.RP_TRACE) console.error(`${ok ? 'ok ' : 'NO '} ${id} ${name}`); return { id, name, ok, detail }; };

export function report(title: string, results: Check[]) {
  const w = Math.min(90, Math.max(...results.map((r) => r.name.length)));
  console.log(`\n${title}\n`);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(6)} ${r.name.padEnd(w)}  ${r.detail.slice(0, 140)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
  return failed;
}
