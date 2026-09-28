/**
 * Roleplay platform test suite.
 *
 *   npm run test:roleplay            unit + integration (needs DATABASE_URL, local only)
 *   npm run test:roleplay -- --unit  unit tests only, no database
 */
import { unitTests } from './roleplay/unit';
import { report, type Check } from './roleplay/harness';

async function main() {
  process.env.RP_LOG_METRICS ??= '0';
  const results: Check[] = await unitTests();
  if (!process.argv.includes('--unit')) {
    const { integrationTests } = await import('./roleplay/integration');
    results.push(...await integrationTests());
  }
  const failed = report('Roleplay platform — spec acceptance catalogue (AT01–AT26) and section checks', results);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
