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
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Isolated from production credentials. E2E_SUPABASE can point to a test project.
      command:
        'node scripts/prepare-ocr.mjs && npx vite build --mode e2e --outDir test-results/app && node scripts/offline-build.mjs test-results/app && npx vite preview --outDir test-results/app --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(process.env.E2E_SUPABASE === '1'
      ? []
      : [
          {
            // Serve a distinct build for the completely intercepted admin RPC tests.
            command:
              'npx vite build --mode e2e --outDir test-results/admin-app && npx vite preview --outDir test-results/admin-app --port 4174 --strictPort',
            env: {
              VITE_SUPABASE_URL: 'https://admin.fixture.supabase.co',
              VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
            },
            url: 'http://localhost:4174',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]),
  ],
});
