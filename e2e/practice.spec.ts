import { test, expect } from './fixtures';

/**
 * A learner's practice, end to end through the browser: the opening can be heard, the customer
 * answers from the scenario, and the report is complete and readable (owner's review, 12 Oct 2026:
 * no turn numbers, no assessor notes, no sentence cut off).
 */
test('a practice runs from the opening to a clean report', async ({ admin: page }) => {
  await page.goto('/roleplay');
  await page.getByRole('button', { name: 'Start practice' }).first().click();
  await expect(page).toHaveURL(/\/roleplay\/s\/[0-9a-f-]+$/);

  // The opening line is shown, and can be read aloud.
  const opening = 'Hello. I need a loan, and I need the money quite soon. Can you help me?';
  await expect(page.getByText(opening)).toBeVisible();
  await page.getByRole('button', { name: /message aloud/ }).first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain(opening);

  // The customer answers from the scenario facts.
  const say = async (text: string, reply: string | RegExp) => {
    await page.getByRole('textbox', { name: 'Your message' }).fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.wa-msg.wa-in').last()).toContainText(reply);
  };
  await say('What do you need the loan for?', "It is for my daughter's college admission");
  await say('How much loan do you need?', 'I need about ₹4 lakh');
  await say('What is your monthly income?', '₹55,000');

  await page.getByRole('button', { name: 'Finish and get feedback' }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole('heading', { name: 'Scoring your conversation…' })).toHaveCount(0, { timeout: 120_000 });

  const report = await page.locator('main').innerText();
  expect(report).toMatch(/Needs Coaching|Developing|Effective|Strong/);
  expect(report, 'no turn numbers').not.toMatch(/\bturns?\s+\d+/i);
  expect(report, 'no turn labels').not.toMatch(/\bT\d+\b/);
  expect(report, 'no assessor notes').not.toMatch(/\((?:Learner asked|No learner turn asked|Learner showed)/);
});
