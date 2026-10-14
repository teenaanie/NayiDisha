import { test, expect } from './fixtures';

/** The main pages load for an administrator without a server error. */
for (const path of ['/', '/roleplay', '/ops/ai-usage', '/ops/simulated-candidates', '/ops/ai-training']) {
  test(`opens ${path}`, async ({ admin: page }) => {
    const res = await page.goto(path);
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText(/Application error|Internal Server Error/)).toHaveCount(0);
  });
}
