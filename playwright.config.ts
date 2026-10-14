import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE_URL, E2E_PORT, E2E_SECRET } from './e2e/env';

/**
 * Browser tests (npm run test:e2e): a real Next.js dev server on a throwaway LOCAL database,
 * with the offline mock AI. e2e/prepare.ts refuses any database that is not on this machine.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A fresh database every run, then the app. Environment variables here override .env.local.
    command: `npx tsx e2e/prepare.ts && npx next dev -p ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      RP_PROVIDER: 'mock',
      RP_LOG_METRICS: '0',
      DEMO_SESSION_SECRET: E2E_SECRET,
      DEMO_PASSWORD: E2E_SECRET,
      GEMINI_API_KEY: '',
      SARVAM_API_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  },
});
