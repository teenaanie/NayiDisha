import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyPatch, type PatchOp } from './patch';
import { parseStrictJson, sha256 } from './compile';

/**
 * Content packages on disk: content/scenarios/<ID>/source.json plus an
 * optional overlay.json of reviewed patch operations. Used by the seed and by
 * tests; the running app reads published bundles from the database only.
 */
export const CONTENT_ROOT = join(process.cwd(), 'content');

/**
 * `archived` loads a frozen earlier package from content/archive/<id>/<version>/ (kept
 * byte-for-byte so its overlay still verifies; tests use it as a fixture). The seed only
 * ever publishes content/scenarios/.
 */
export function loadScenarioPackage(id: string, opts: { archived?: string } = {}) {
  const dir = opts.archived ? join(CONTENT_ROOT, 'archive', id, opts.archived) : join(CONTENT_ROOT, 'scenarios', id);
  const sourceText = readFileSync(join(dir, 'source.json'), 'utf8');
  const source = parseStrictJson(sourceText);
  const overlayPath = join(dir, 'overlay.json');
  let bundle = source;
  let overlay: { source_sha256?: string; ops: PatchOp[] } | null = null;
  if (existsSync(overlayPath)) {
    overlay = parseStrictJson(readFileSync(overlayPath, 'utf8')) as { source_sha256?: string; ops: PatchOp[] };
    const actual = sha256(sourceText);
    if (overlay.source_sha256 && overlay.source_sha256 !== actual) throw new Error(`${id}: source.json changed (sha256 ${actual}); review overlay.json before seeding.`);
    bundle = applyPatch(source, overlay.ops);
  }
  return { id, source, bundle, overlayOps: overlay?.ops.length ?? 0, sourceSha256: sha256(sourceText) };
}

export const scenarioPackages = () => readdirSync(join(CONTENT_ROOT, 'scenarios'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

export function loadPrompt(id: string) {
  return readFileSync(join(CONTENT_ROOT, 'prompts', `${id}.txt`), 'utf8');
}
