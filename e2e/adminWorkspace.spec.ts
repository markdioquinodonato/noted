import { test, expect, type Page } from '@playwright/test';

const ownerId = 'f0000000-0000-4000-8000-000000000001';
const endpoints = [
  ['', 'Operations overview'],
  ['users', 'User management'],
  ['user-analytics', 'User analytics'],
  ['platform-analytics', 'Platform analytics'],
  ['supabase', 'Supabase monitoring'],
  ['cloudflare', 'Cloudflare monitoring'],
  ['health', 'System health'],
  ['storage', 'Storage & database'],
  ['transcription', 'Audio transcription analytics'],
  ['ai-usage', 'AI usage & costs'],
  ['announcements', 'Announcements'],
  ['security', 'Security & audit logs'],
  ['releases', 'Application releases'],
  ['settings', 'Admin settings'],
  ['notifications', 'Notifications'],
] as const;

async function signInFixture(
  page: Page,
  access: { member: boolean; authorized: boolean; central_authorized?: boolean },
) {
  const user = {
    id: ownerId,
    email: 'admin@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  };
  await page.addInitScript((user) => {
    const payload = btoa(
      JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal2' }),
    ).replace(/=+$/, '');
    localStorage.setItem(
      'noted-auth',
      JSON.stringify({
        access_token: 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.test',
        refresh_token: 'test-only',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
        token_type: 'bearer',
      }),
    );
  }, user);
  await page.route('https://admin.fixture.supabase.co/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (endpoint === 'logout') return route.fulfill({ status: 204 });
    const now = new Date().toISOString();
    const responses: Record<string, unknown> = {
      user,
      admin_access: access,
      notes: [],
      folders: [],
      tags: [],
      admin_workspace_snapshot: {
        registered_users: 0,
        confirmed_users: 0,
        cloud_notes: 0,
        database_bytes: 1048576,
        storage_bytes: 0,
        database_connections: 1,
        generated_at: now,
        storage_history: [],
        event_totals: { app_errors: 0, sync_failures: 0 },
        ai_writing: [],
        thresholds: [],
        errors: [],
        audit: [],
        auth_audit: [],
        provider_metrics: [],
        transcription: [],
      },
      admin_analytics: { days: [], platforms: [] },
      admin_user_directory: { total: 0, rows: [] },
      admin_announcements: { items: [], history: [] },
      admin_save_announcement: 'f0000000-0000-4000-8000-000000000002',
      admin_alert_inbox: { items: [], last_checked: now },
      transcription_admin_stats: [],
      admin_cloudflare_history: [],
      transcribe: {
        provider: 'Deepgram',
        model: 'nova-3',
        diarizer: 'v2',
        available: false,
        ratePerMinute: null,
      },
      noted_announcements: [],
    };
    if (!(endpoint && endpoint in responses)) return route.fulfill({ status: 404, json: {} });
    await route.fulfill({ json: responses[endpoint] });
  });
}

test.describe('admin workspace with isolated API fixtures', () => {
  test.use({ baseURL: 'http://localhost:4174' });
  test.skip(
    process.env.E2E_SUPABASE === '1',
    'Uses a fixture-only client when a hosted cloud test project is absent.',
  );
  test('all routes render with the appropriate title on desktop and mobile', async ({
    page,
  }, testInfo) => {
    await signInFixture(page, { member: true, authorized: true, central_authorized: true });
    await page.route('**/release.json', (route) =>
      route.fulfill({ json: { version: '1.1.1', builtAt: '2026-11-14T00:00:00Z' } }),
    );
    for (const [path, heading] of endpoints) {
      await page.goto('/admin' + (path ? '/' + path : ''));
      await expect(
        page.getByRole('heading', { name: heading, level: 1, exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
    }
    await page.goto('/admin');
    await expect(page.getByText('Cloud notes', { exact: true })).toBeVisible();
    await expect(page.getByText('Active users trend', { exact: true })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveClass('dark');
    const shots = process.env.NOTED_ADMIN_SCREENSHOTS;
    if (shots)
      await page.screenshot({
        path: shots + '/' + testInfo.project.name + '-light.png',
        fullPage: testInfo.project.name === 'desktop-chromium',
      });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    if (shots)
      await page.screenshot({
        path: shots + '/' + testInfo.project.name + '-dark.png',
        fullPage: testInfo.project.name === 'desktop-chromium',
      });

    if (testInfo.project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Open admin navigation' }).click();
      await page.getByRole('link', { name: 'User Management' }).click();
    } else {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await page.getByRole('link', { name: 'User Management' }).click();
    }
    await expect(page).toHaveURL('/admin/users');
  });

  test('activity window requests and chart data agree', async ({ page }) => {
    await signInFixture(page, { member: true, authorized: true, central_authorized: true });
    const requested: number[] = [];
    await page.route('**/rest/v1/rpc/admin_analytics', async (route) => {
      const { p_days: days } = route.request().postDataJSON() as { p_days: number };
      requested.push(days);
      const rows = Array.from({ length: 2 * days }, (_, index) => ({
        day: new Date(Date.UTC(2026, 10, 14 - (2 * days - 1 - index))).toISOString().slice(0, 10),
        dau: index < days ? 1 : 2,
        wau: 4,
        mau: 6,
        registrations: 1,
        guests: null,
        notes_created: null,
        notes_updated: null,
        errors: null,
        sync_failed: null,
        sync_offline: null,
      }));
      await route.fulfill({ json: { days: rows, platforms: [] } });
    });
    await page.goto('/admin/user-analytics');
    await page.getByLabel('Date range').selectOption('7');
    const chart = page
      .getByRole('heading', { name: 'Active users trend' })
      .locator('..')
      .locator('..')
      .locator('..');
    await expect(chart.locator('.recharts-surface')).toBeVisible();
    await chart.getByText('View chart data').click();
    const table = page.getByRole('table', { name: 'Active users trend' });
    await expect(table.getByRole('row')).toHaveCount(8);
    await expect(table.getByRole('row').last()).toContainText('2026-11-14');
    await expect(table.getByRole('row').last().getByRole('cell').nth(1)).toHaveText('2');
    await expect(table.getByRole('row').last().getByRole('cell').nth(2)).toHaveText('1');
    await page.getByLabel('Active-user window').selectOption('wau');
    await expect(table.getByRole('row').last().getByRole('cell').nth(1)).toHaveText('4');
    expect(requested).toContain(7);
  });

  test('ordinary accounts cannot mount the workspace', async ({ page }) => {
    await signInFixture(page, { member: false, authorized: false });
    const accessResponse = page.waitForResponse('**/rest/v1/rpc/admin_access');
    await page.goto('/notes');
    await accessResponse;
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Admin Dashboard' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(
      page.getByRole('heading', { name: 'Administrator access required' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
  });

  test('verified central admins can open administration from the profile menu', async ({
    page,
  }) => {
    await signInFixture(page, { member: true, authorized: true, central_authorized: true });
    await page.goto('/notes');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Admin Dashboard', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Operations overview', level: 1 }),
    ).toBeVisible();
  });

  test('one Sign Out clears the account session and keeps guest notes available', async ({
    page,
  }) => {
    await page.goto('/welcome');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    const note = 'A guest note to keep';
    await page.getByTestId('import-txt-input').setInputFiles({
      name: note + '.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Stored on this device.'),
    });
    await expect(page.getByTestId('note-list').getByText(note, { exact: true })).toBeVisible();
    const options = page.getByRole('button', { name: 'View options', exact: true });
    await options.click();
    await page.getByRole('menuitemradio', { name: 'Clean List', exact: true }).click();

    await signInFixture(page, { member: false, authorized: false });
    await page.goto('/notes');
    await expect(page.getByTestId('note-list').getByText(note, { exact: true })).toHaveCount(0);
    await options.click();
    await expect(
      page.getByRole('menuitemradio', { name: 'Comfortable Grid', exact: true, checked: true }),
    ).toBeVisible();
    await page.getByRole('menuitemradio', { name: 'Compact Grid', exact: true }).click();
    const profile = page.getByRole('button', { name: 'Profile', exact: true });
    await expect(profile).toHaveCount(1);
    await profile.click();
    await page.getByRole('menuitem', { name: 'My Profile', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\?section=account$/);
    await profile.click();
    const signOut = page.getByRole('menuitem', { name: 'Sign Out', exact: true });
    await expect(signOut).toHaveCount(1);
    const logout = page.waitForResponse('**/auth/v1/logout?scope=local');
    await signOut.click();
    expect((await logout).status()).toBe(204);
    await expect(page).toHaveURL(/\/welcome$/);
    expect(await page.evaluate(() => localStorage.getItem('noted-auth'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('noted:mode'))).toBeNull();

    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await expect(page.getByTestId('note-list').getByText(note, { exact: true })).toBeVisible();
    await expect(page.locator('ul[data-layout]')).toHaveAttribute('data-layout', 'list');
  });

  test('scoped transcription access hides central navigation', async ({ page }) => {
    await signInFixture(page, { member: true, authorized: true, central_authorized: false });
    await page.goto('/admin/transcription');
    await expect(
      page.getByRole('heading', { name: 'Audio transcription analytics' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'User Management' })).toHaveCount(0);
  });
});
