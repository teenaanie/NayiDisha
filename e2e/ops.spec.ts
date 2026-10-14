import { test, expect } from './fixtures';

/** Operator pages: the simulated candidates run end to end (mock AI), and AI training opens. */
test('a small simulated-candidate run completes and shows calibration', async ({ admin: page }) => {
  await page.goto('/ops/simulated-candidates');
  await expect(page.getByRole('heading', { name: 'Simulated candidates' })).toBeVisible();
  for (const name of [/Competent/, /Excellent/]) await page.getByRole('checkbox', { name }).uncheck();
  await page.getByLabel('Practice sessions per candidate').fill('1');
  await page.getByLabel('Messages per session').fill('4');
  await page.getByRole('button', { name: 'Run the simulation' }).click();
  await expect(page).toHaveURL(/\/ops\/simulated-candidates\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: /Simulation\s+Completed/ })).toBeVisible({ timeout: 170_000 });
  const calibration = page.locator('section', { has: page.getByRole('heading', { name: 'Calibration' }) });
  await expect(calibration.getByText('Needs improvement')).toBeVisible();
  await expect(calibration.getByText(/In band|Outside band/)).toBeVisible();
});

test('the AI training page opens', async ({ admin: page }) => {
  await page.goto('/ops/ai-training');
  await expect(page.getByRole('heading', { name: 'AI training' })).toBeVisible();
});
