/**
 * Provider-neutral model interface (spec §4, §22).
 *
 * Every model call in the platform goes through `ModelProvider.complete`: a
 * task name, a system template, and the data blocks that template references.
 * Content is always passed as serialized data, never concatenated into the
 * governing instructions (spec §15).
 *
 *   mock  deterministic, offline, free; drives every test and local demo.
 *   live  any OpenAI-compatible chat-completions endpoint (OpenAI, Azure
 *         OpenAI, OpenRouter, Sarvam, Gemini's compatibility endpoint, a
 *         local vLLM). Selected by env; nothing here names a vendor.
 */
import { mockComplete } from './mock';
import { recordUsage, openaiTokens, billedOutputTokens } from '@/modules/ai-usage';

export type Task = 'roleplay' | 'evaluate' | 'coach' | 'classify' | 'train' | 'simulate';

export interface CompletionRequest {
  task: Task;
  /** Template text with {{placeholders}}; rendered by the adapter. */
  template: string;
  /** Values for the placeholders. Serialized as JSON data blocks. */
  data: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
  /**
   * The contract the output must satisfy. Live adapters ask the provider for
   * structured output against it; the server still validates every response
   * strictly, so this improves the hit rate without weakening any check.
   */
  schema?: Record<string, unknown>;
  /** For budget and trace correlation only; never sent to the provider. */
  correlation: { tenant_id: string; session_id?: string; operation_id?: string; evaluation_id?: string };
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  request_id: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  latency_ms: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly live: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs: number | null = null) { super(message); }
}

/** Placeholders become JSON; a transcript can never close a block and start issuing instructions. */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in data)) throw new Error(`Template placeholder {{${key}}} has no data.`);
    return JSON.stringify(data[key]);
  });
}

class MockProvider implements ModelProvider {
  readonly id = 'mock';
  readonly model = 'mock-deterministic-1';
  readonly live = false;
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    // Render anyway so a template/data mismatch fails in tests exactly as it would live.
    renderTemplate(req.template, req.data);
    const text = await mockComplete(req);
    return { text, provider: this.id, model: this.model, request_id: null, usage: null, latency_ms: Date.now() - started };
  }
}

/**
 * Structured-output engines accept a subset of JSON Schema. Keep the shape
 * (types, required fields, enums) and drop the refinements they commonly reject;
 * the server-side validator re-applies all of them.
 */
export function providerSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(providerSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (['pattern', 'uniqueItems', 'additionalProperties', 'minLength', 'maxLength', 'maxItems', 'minItems', 'minimum', 'maximum'].includes(k)) continue;
    if (k === 'const') { out.enum = [v]; continue; }
    out[k] = providerSchema(v);
  }
  // A property map with no keys means "any object"; say so explicitly.
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

class OpenAICompatibleProvider implements ModelProvider {
  readonly id = 'openai_compatible';
  readonly live = true;
  constructor(private base: string, private key: string, readonly model: string) {}
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model: this.model,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          // Reasoning models spend output tokens thinking; turn it down where the provider allows.
          // A per-task override (e.g. RP_LLM_REASONING_EFFORT_EVALUATE=low) lets the assessment think while replies stay fast.
          ...((): { reasoning_effort?: string } => {
            // The training agent reviews many sessions and should think; a deployment-wide "none"
            // (for fast replies) does not apply to it, and Gemini 2.5 Pro cannot turn thinking off.
            const effort = process.env[`RP_LLM_REASONING_EFFORT_${req.task.toUpperCase()}`] ?? (req.task === 'train' ? 'medium' : process.env.RP_LLM_REASONING_EFFORT);
            return effort ? { reasoning_effort: effort } : {};
          })(),
          response_format: req.schema
            ? { type: 'json_schema', json_schema: { name: req.task, schema: providerSchema(req.schema) } }
            : { type: 'json_object' },
          messages: [{ role: 'system', content: renderTemplate(req.template, req.data) }, { role: 'user', content: 'Return the JSON object now.' }],
        }),
        // A customer reply must be quick; an assessment of a whole transcript may not be.
        signal: AbortSignal.timeout(req.task === 'roleplay' || req.task === 'classify' || req.task === 'simulate'
          ? Number(process.env.RP_PROVIDER_TIMEOUT_MS ?? 30000)
          : req.task === 'train' ? Number(process.env.RP_TRAIN_TIMEOUT_MS ?? 240000)
          : Number(process.env.RP_EVAL_TIMEOUT_MS ?? 120000)),
      });
    } catch (e) {
      throw new ProviderError(`Provider unreachable: ${(e as Error).name}`, true);
    }
    if (!res.ok) recordUsage({ provider: 'openai_compatible', model: this.model, feature: `roleplay.${req.task}`, ok: false, latencyMs: Date.now() - started });
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('retry-after'));
      throw new ProviderError(`Provider returned HTTP ${res.status}`, true, Number.isFinite(after) && after > 0 ? after * 1000 : null);
    }
    if (!res.ok) throw new ProviderError(`Provider returned HTTP ${res.status}`, false);
    const body = await res.json();
    recordUsage({ provider: 'openai_compatible', model: this.model, feature: `roleplay.${req.task}`, ...openaiTokens(body), latencyMs: Date.now() - started });
    return {
      text: String(body?.choices?.[0]?.message?.content ?? ''),
      provider: this.id, model: this.model,
      request_id: body?.id ?? res.headers.get('x-request-id'),
      usage: body?.usage ? { input_tokens: body.usage.prompt_tokens ?? 0, output_tokens: billedOutputTokens(body.usage) } : null,
      latency_ms: Date.now() - started,
    };
  }
}

/**
 * RP_PROVIDER=mock (default) or openai_compatible with RP_LLM_BASE_URL,
 * RP_LLM_API_KEY and RP_LLM_MODEL. The roleplay and evaluator may use
 * different models (RP_LLM_MODEL_EVALUATOR) but never share a call.
 */
export function providerFor(task: Task): ModelProvider {
  if ((process.env.RP_PROVIDER ?? 'mock') === 'openai_compatible') {
    // RP_LLM_API_KEY_FROM names another variable holding the key (e.g. GEMINI_API_KEY),
    // so a deployment can reuse an existing secret instead of copying it.
    const base = process.env.RP_LLM_BASE_URL;
    const key = process.env.RP_LLM_API_KEY || (process.env.RP_LLM_API_KEY_FROM ? process.env[process.env.RP_LLM_API_KEY_FROM] : undefined);
    // Separate models per task are optional; on quota-limited tiers they also spread usage across buckets.
    const model = (task === 'evaluate' || task === 'coach') ? (process.env.RP_LLM_MODEL_EVALUATOR ?? process.env.RP_LLM_MODEL)
      : task === 'classify' ? (process.env.RP_LLM_MODEL_CLASSIFIER ?? process.env.RP_LLM_MODEL)
      : task === 'train' ? (process.env.RP_LLM_MODEL_TRAINER ?? process.env.RP_LLM_MODEL)
      : task === 'simulate' ? (process.env.RP_LLM_MODEL_SIMULATOR ?? process.env.RP_LLM_MODEL) : process.env.RP_LLM_MODEL;
    if (!base || !key || !model) throw new Error('RP_PROVIDER=openai_compatible needs RP_LLM_BASE_URL, RP_LLM_MODEL and a key (RP_LLM_API_KEY, or RP_LLM_API_KEY_FROM naming the variable that holds it).');
    return new OpenAICompatibleProvider(base, key, model);
  }
  return new MockProvider();
}

// ---- test seam -----------------------------------------------------------------
// Acceptance tests replace a task's provider to simulate invalid JSON, outages
// and disagreements (AT22, AT23). Never set outside tests.
const overrides = new Map<Task, ModelProvider>();
export function overrideProvider(task: Task, p: ModelProvider | null) { if (p) overrides.set(task, p); else overrides.delete(task); }
export function resolveProvider(task: Task): ModelProvider { return overrides.get(task) ?? providerFor(task); }

/**
 * Circuit breaker (spec §24): after sustained failures a provider is paused
 * for a cool-down, and calls fail fast as retryable instead of piling up.
 * Per process; each serverless instance learns independently, which is enough
 * to stop a request storm without a shared store.
 */
const breaker = new Map<string, { failures: number; openUntil: number }>();
const BREAKER_THRESHOLD = Number(process.env.RP_BREAKER_THRESHOLD ?? 5);
const BREAKER_COOLDOWN_MS = Number(process.env.RP_BREAKER_COOLDOWN_MS ?? 30000);
export function breakerState(providerId: string) { return breaker.get(providerId) ?? { failures: 0, openUntil: 0 }; }
export function resetBreakers() { breaker.clear(); }

/** Retry transient failures up to three attempts with backoff and jitter, honouring Retry-After (spec §24). */
export async function completeWithRetry(req: CompletionRequest, provider = resolveProvider(req.task), attempts = 3): Promise<CompletionResult> {
  let last: unknown;
  const state = breakerState(provider.id);
  if (state.openUntil > Date.now()) throw new ProviderError(`Provider ${provider.id} is paused after repeated failures.`, true, state.openUntil - Date.now());
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await provider.complete(req);
      breaker.set(provider.id, { failures: 0, openUntil: 0 });
      return res;
    }
    catch (e) {
      last = e;
      const s = breakerState(provider.id);
      const failures = s.failures + 1;
      breaker.set(provider.id, { failures, openUntil: failures >= BREAKER_THRESHOLD ? Date.now() + BREAKER_COOLDOWN_MS : 0 });
      if (failures >= BREAKER_THRESHOLD) break;
      if (!(e instanceof ProviderError) || !e.retryable || i === attempts - 1) break;
      const base = e.retryAfterMs ?? 1000 * 2 ** i;
      const wait = Math.min(base + Math.random() * 250, Number(process.env.RP_MAX_BACKOFF_MS ?? 8000));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}
