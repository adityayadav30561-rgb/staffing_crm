import { defineConfig } from '@playwright/test';

const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm_e2e';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  webServer: [
    {
      command: 'pnpm --filter @crm/api exec tsx src/main.ts',
      url: 'http://localhost:3101/api/health',
      env: {
        DATABASE_URL: E2E_DB,
        PORT: '3101',
        AUTOMATION_INTERVAL_MS: '0',
        UPLOAD_DIR: '/tmp/crm-e2e-uploads',
        TZ: 'Asia/Kolkata',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @crm/web exec vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { API_URL: 'http://localhost:3101' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
