import { test, expect, chromium } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});
test('guest can capture a camera photo and recognize English text entirely offline', async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const external: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://localhost:4173/'))
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(page.getByText('Welcome to Noted', { exact: true })).toBeVisible();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 320;
    const c = canvas.getContext('2d')!;
    c.fillStyle = 'white';
    c.fillRect(0, 0, 1200, 320);
    c.fillStyle = 'black';
    c.font = 'bold 52px Arial';
    c.fillText('NOTED GUEST SCANNER', 40, 110);
    c.font = '36px Arial';
    c.fillText('Local notes stay on this device', 40, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((done) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }),
      );
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('Scanned text');
  await page.getByRole('button', { name: 'Scan text with camera', exact: true }).click();
  await expect(page.getByLabel('Camera preview')).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.videoWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Capture photo' }).click();
  await expect(page.getByAltText('Photo to scan')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByLabel('Choose scanner image').setInputFiles({
    name: 'printed-english.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('textbox', { name: 'Recognized text', exact: true })).toHaveValue(
    /NOTED GUEST SCANNER/,
    { timeout: 40000 },
  );
  await page
    .getByRole('textbox', { name: 'Recognized text', exact: true })
    .fill('NOTED GUEST SCANNER\nEdited recognized text');
  await page.getByRole('button', { name: 'Insert into note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText(
    'Edited recognized text',
  );
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText(
    'Edited recognized text',
  );
  expect(external).toEqual([]);
  await context.setOffline(false);
});

test('guest account menu exposes optional account actions and data information', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  if ((page.viewportSize()?.width ?? 1000) < 768)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Guest account menu' }).click();
  for (const name of [
    'Log In',
    'Create Account',
    'Import Notes',
    'Export Notes',
    'Guest Data Information',
  ])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Guest Data Information' }).click();
  await expect(page.getByRole('dialog')).toContainText('does not provide cloud backups');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Guest account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fimport/);
  await expect(page.getByText(/Cloud accounts aren’t configured/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to notes' }).click();
  await expect(page.getByTestId('list-heading')).toBeVisible();
});

test('guest IndexedDB notes survive a complete browser restart', async ({ browserName }, info) => {
  test.setTimeout(60000);
  expect(browserName).toBe('chromium');
  const root = resolve('test-results');
  await mkdir(root, { recursive: true });
  const profile = await mkdtemp(join(root, 'noted-profile-'));
  let context = await chromium.launchPersistentContext(profile, {
    viewport: info.project.use.viewport,
  });
  try {
    let page = await context.newPage();
    await page.goto('http://localhost:4173/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Persistent guest journal');
    await page.getByRole('textbox', { name: 'Note content' }).fill('Kept across browser processes');
    await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
      'data-status',
      'saved',
    );
    const url = page.url();
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      viewport: info.project.use.viewport,
    });
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
      'Kept across browser processes',
    );
  } finally {
    await context.close();
    const absolute = await realpath(profile);
    // Windows may briefly keep Chrome's log file locked after close; retry, and never
    // let temp-profile cleanup turn a passing persistence check into a failure.
    if (absolute.startsWith(root + sep))
      await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
        () => undefined,
      );
  }
});

test('guest sees an honest warning when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    for (const storage of ['localStorage', 'sessionStorage'])
      Object.defineProperty(window, storage, {
        configurable: true,
        get: () => {
          throw new DOMException('Storage denied', 'SecurityError');
        },
      });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Local browser storage is unavailable or full.' }),
  ).toBeVisible();
  await expect(page.getByText('Welcome to Noted', { exact: true })).toBeVisible();
});
