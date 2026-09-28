import type { ScenarioBundle, Money } from '../contracts/types';
import { runtimeOf } from './runtime-extension';

/**
 * RFC 6902 JSON Patch, the subset the content overlays use: test, add, replace.
 *
 * Source bundles are kept byte-identical to what the product owner supplied;
 * every recommended change is an explicit, reviewable operation with a reason,
 * so a discrepancy is resolved in the open rather than by silently editing
 * source facts.
 */

export interface PatchOp { op: 'test' | 'add' | 'replace'; path: string; value: unknown; why?: string }

function parts(path: string) { return path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')); }

export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  const out = JSON.parse(JSON.stringify(doc)) as T;
  for (const [i, o] of ops.entries()) {
    const keys = parts(o.path);
    const last = keys.pop()!;
    let parent: any = out;
    for (const k of keys) {
      if (parent === null || typeof parent !== 'object' || !(k in parent)) throw new Error(`Patch op ${i}: path ${o.path} does not exist.`);
      parent = parent[k];
    }
    if (o.op === 'test') {
      if (JSON.stringify(parent?.[last]) !== JSON.stringify(o.value)) throw new Error(`Patch op ${i}: test failed at ${o.path}; the source has changed, review the overlay.`);
    } else if (o.op === 'replace') {
      if (!(last in parent)) throw new Error(`Patch op ${i}: nothing to replace at ${o.path}.`);
      parent[last] = o.value;
    } else if (Array.isArray(parent)) {
      if (last === '-') parent.push(o.value); else parent.splice(Number(last), 0, o.value);
    } else {
      if (last in parent) throw new Error(`Patch op ${i}: ${o.path} exists; use replace.`);
      parent[last] = o.value;
    }
  }
  return out;
}

/** Evaluate configured derivations: exact integer arithmetic, labelled conditional, never a loan figure. */
export function computeDerivations(b: ScenarioBundle) {
  const facts = new Map(b.facts.map((f) => [f.id, f]));
  return runtimeOf(b).derivations.map((d) => {
    const values = d.input_fact_ids.map((id) => facts.get(id)?.value as Money | null);
    const known = values.every((v) => v && typeof v === 'object' && 'amount_minor' in v);
    const currency = known ? (values[0] as Money).currency : null;
    const amount = known && values.every((v) => (v as Money).currency === currency)
      ? values.slice(1).reduce((acc, v) => acc - (v as Money).amount_minor, (values[0] as Money).amount_minor)
      : null;
    return {
      id: d.id, conditional: true as const,
      value: amount === null ? null : { amount_minor: amount, currency: currency! },
      input_fact_ids: d.input_fact_ids, assumptions: d.assumptions, excluded_note: d.excluded_note,
    };
  });
}
