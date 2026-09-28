'use client';
/** Browser client for /v1: idempotency keys on mutating calls, the error envelope unwrapped. */
export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean, readonly details: Record<string, unknown>) { super(message); }
}
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(`/v1/${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiFailure(res.status, e.code ?? 'ERROR', e.message ?? 'Something went wrong.', !!e.retryable, e.details ?? {});
  }
  return { status: res.status, data };
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
