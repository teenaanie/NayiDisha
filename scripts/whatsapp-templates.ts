/**
 * Submit the message templates to Meta for review, or report where they stand.
 *
 * Meta will not deliver a business-initiated message that is not an approved
 * template, so this is the gate between a working adapter and a working
 * journey. Review is usually about a day and first-round rejections are normal.
 *
 *   npx tsx scripts/whatsapp-templates.ts            # show local vs Meta
 *   npx tsx scripts/whatsapp-templates.ts --submit   # create the missing ones
 *
 * Nothing is deleted and nothing approved is edited: an approved template is
 * the thing standing between you and a silent delivery failure.
 */
import { sql } from '../src/lib/db';
import { cloudApiConfig, orderedPlaceholders, metaTemplateName } from '../src/modules/adapters/messaging';

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'}`;

/** Meta's category names for ours. SERVICE is not one of theirs. */
const CATEGORY: Record<string, 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'> = {
  SERVICE: 'UTILITY', UTILITY: 'UTILITY', MARKETING: 'MARKETING', AUTHENTICATION: 'AUTHENTICATION',
};

/** Meta wants IETF-ish codes; the seed stores bare language keys. */
const LANG: Record<string, string> = { en: 'en', hi: 'hi', mr: 'mr' };

/** Plausible values for review. Meta rejects templates whose examples are empty. */
const SAMPLE: Record<string, string> = {
  title: 'Relationship Executive', employer: 'Sahyadri Bank', locality: 'Shivajinagar',
  fixed: '18000', minutes: '35', change: 'Updated shift timing', code: '123456',
  name: 'Sunita', date: '12 October', time: '10:30 AM', address: 'FC Road Branch',
  role: 'Delivery Rider', amount: '75', reason: 'Address proof was unreadable',
};

async function metaTemplates(wabaId: string, token: string) {
  const out = new Map<string, string>();
  let url: string | null = `${GRAPH}/${wabaId}/message_templates?limit=200`;
  while (url) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json: any = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    for (const t of json.data ?? []) out.set(`${t.name}:${t.language}`, t.status);
    url = json?.paging?.next ?? null;
  }
  return out;
}

async function main() {
  const submit = process.argv.includes('--submit');
  const cfg = cloudApiConfig();
  const wabaId = cfg?.wabaId;

  const rows = await sql<{ key: string; language: string; category: string; body: string }[]>`
    SELECT key, language, category, body FROM app.message_template ORDER BY key, language
  `;
  console.log(`${rows.length} local templates (${new Set(rows.map(r => r.key)).size} keys x ${new Set(rows.map(r => r.language)).size} languages)`);

  if (!cfg || !wabaId) {
    console.log('\nWHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN are not set, so this is a dry run.');
    console.log('What would be submitted:\n');
    for (const r of rows.slice(0, 3)) {
      const vars = orderedPlaceholders(r.body);
      console.log(`  ${metaTemplateName(r.key, r.language)}  [${CATEGORY[r.category]}]  ${vars.length} variable(s)`);
      console.log(`    ${r.body.replace(/\{\{(\w+)\}\}/g, (_, k) => `{{${vars.indexOf(k) + 1}}}`).slice(0, 96)}`);
    }
    console.log(`  … and ${rows.length - 3} more`);
    await sql.end();
    return;
  }

  const remote = await metaTemplates(wabaId, cfg.accessToken);
  let created = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const name = metaTemplateName(r.key, r.language);
    const lang = LANG[r.language] ?? r.language;
    const existing = remote.get(`${name}:${lang}`);
    if (existing) {
      console.log(`  ${existing.padEnd(10)} ${name}`);
      skipped += 1;
      continue;
    }
    if (!submit) { console.log(`  MISSING    ${name}`); continue; }

    // Named placeholders become positional, in the order they first appear.
    const vars = orderedPlaceholders(r.body);
    const text = r.body.replace(/\{\{(\w+)\}\}/g, (_, k) => `{{${vars.indexOf(k) + 1}}}`);
    const component: Record<string, unknown> = { type: 'BODY', text };
    if (vars.length) component.example = { body_text: [vars.map(v => SAMPLE[v] ?? v)] };

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ name, language: lang, category: CATEGORY[r.category] ?? 'UTILITY', components: [component] }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok) { console.log(`  CREATED    ${name}`); created += 1; }
    else { console.log(`  FAILED     ${name} — ${json?.error?.error_user_msg ?? json?.error?.message ?? res.status}`); failed += 1; }
  }

  console.log(`\n${created} created, ${skipped} already at Meta, ${failed} failed.`);
  if (!submit) console.log('Re-run with --submit to create the missing ones.');
  await sql.end();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
