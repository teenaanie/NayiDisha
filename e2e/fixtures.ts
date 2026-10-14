import { test as base, expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { E2E_SECRET, E2E_PORT } from './env';

/** The app's demo identity cookie, signed with the local test secret. */
export function identityCookie(id: string, role: string) {
  const body = Buffer.from(JSON.stringify({ id, role, expires: Date.now() + 3_600_000 })).toString('base64url');
  return { name: 'nd_identity', value: `${body}.${createHmac('sha256', E2E_SECRET).update(body).digest('base64url')}`, url: `http://127.0.0.1:${E2E_PORT}` };
}

/** Signed in as the demo administrator (operator pages, practice coach). Records speech instead of playing it. */
export const test = base.extend<{ admin: Page }>({
  admin: async ({ page, context }, use) => {
    await context.addCookies([identityCookie('ADMIN-001', 'ADMIN')]);
    await page.addInitScript(() => {
      (window as unknown as { __spoken: string[] }).__spoken = [];
      if ('speechSynthesis' in window) window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { (window as unknown as { __spoken: string[] }).__spoken.push(u.text); };
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});
export { expect };
