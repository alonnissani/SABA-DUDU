import { defineConfig } from '@playwright/test';

/**
 * בדיקות קצה-לקצה בדפדפן אמיתי מול שרת פיתוח מקומי (Vite + Workers + D1/R2 מקומיים).
 * דורש בסיס נתונים מקומי ריק: npm run e2e:reset
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'he-IL',
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173/api/auth/status', reuseExistingServer: true, timeout: 60_000 },
});
