import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the PRODUCTION build (vite preview) in a fresh browser
 * context per test (isolated IndexedDB/localStorage).
 *
 * Cloud/auth journeys need a dedicated Supabase TEST project. They are skipped
 * unless E2E_SUPABASE=1 and the VITE_SUPABASE_* variables in .env.e2e.local point to that
 * project (the build runs in `e2e` mode and never reads production env files).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // `--mode e2e` loads .env.e2e(.local) only, never .env.production.local, so local
    // E2E runs can't reach the live Supabase project by accident.
    command:
      'node scripts/prepare-ocr.mjs && npx vite build --mode e2e && node scripts/offline-build.mjs && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
