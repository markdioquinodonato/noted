// Drives the installed Noted Android app on an emulator through real user journeys.
// Needs the DEBUG build (its WebView is debuggable, so Playwright can attach).
//
//   node e2e-android/smoke.mjs <out-dir>
//
// Writes a screenshot per step plus results.txt, and exits 1 if any step failed.
import { _android } from 'playwright-core';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const PKG = 'ph.noted.app';
const OUT = process.argv[2] ?? 'android-test';
await mkdir(OUT, { recursive: true });

const results = [];
const jsErrors = [];
let failed = false;

const [device] = await _android.devices();
if (!device) throw new Error('No Android device/emulator connected');
console.log(`Device: ${device.model()} (${device.serial()})`);

const shell = async (cmd) => (await device.shell(cmd)).toString().trim();
const shot = async (name) => writeFile(`${OUT}/${name}.png`, await device.screenshot());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  await shell(`am force-stop ${PKG}`);
  await shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && jsErrors.push(`console.error: ${m.text()}`));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed = true;
    const msg = String(e?.message ?? e)
      .split('\n')
      .slice(0, 3)
      .join(' | ');
    results.push(`FAIL  ${name}: ${msg}`);
    console.log(`FAIL  ${name}\n${e?.stack ?? e}`);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

const title = `Android ${Date.now()}`;
let page = await launch();

await step('app opens on the welcome screen', async () => {
  await expect(page.getByRole('button', { name: 'Continue as Guest' })).toBeVisible({
    timeout: 30_000,
  });
  await sleep(1500);
  await shot('01-welcome');
});

await step('web content stays out of the status bar and navigation bar', async () => {
  const size = await shell('wm size'); // "Physical size: 1080x2400"
  const [, w, h] = size.match(/(\d+)x(\d+)/) ?? [];
  const view = await page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  const usedPx = Math.round(view.h * view.dpr);
  console.log(`screen ${w}x${h}px, webview ${view.w}x${view.h}css @${view.dpr} = ${usedPx}px tall`);
  // The status bar alone is >= 24dp; the WebView must be shorter than the screen by at least that.
  expect(Number(h) - usedPx).toBeGreaterThanOrEqual(Math.round(24 * view.dpr));
});

await step('guest can create and autosave a note', async () => {
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(page).toHaveURL(/\/notes/);
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note content' }).fill('Typed on Android ✓ 日本語');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 10_000 },
  );
  await shot('02-note-editor');
});

await step('Android keyboard input reaches the editor', async () => {
  const body = page.getByRole('textbox', { name: 'Note content' });
  await body.click();
  await page.keyboard.press('End');
  await shell('input text " via-keyboard"');
  await expect(body).toContainText('via-keyboard', { timeout: 10_000 });
  await sleep(1000);
  await shot('03-typing');
  await shell('input keyevent 111'); // ESC: hide the soft keyboard if shown
});

await step('note survives closing and reopening the app', async () => {
  await sleep(1500);
  page = await launch();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  await shot('04-after-restart');
});

await step('Android back button navigates inside the app instead of quitting', async () => {
  const back = page.getByRole('button', { name: 'Back to notes list' });
  if (!(await back.isVisible())) await page.getByText(title).first().click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
  const before = page.url();
  await shell('input keyevent 4'); // KEYCODE_BACK
  await expect.poll(() => page.url(), { timeout: 10_000 }).not.toBe(before);
  expect(await shell(`pidof ${PKG}`)).not.toBe('');
  await shot('05-after-back');
});

await step('export as .txt opens the Android save dialog and saves', async () => {
  await page.getByText(title).first().click();
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Export as .txt' }).click();
  // System "Save to" picker (DocumentsUI) — confirm with its Save button.
  const save = { res: /com\.(google\.)?android\.documentsui:id\/(action_menu_)?(save|positive)/ };
  await device.wait(save, { timeout: 20_000 });
  await shot('06-save-dialog');
  await device.tap(save);
  await expect(page.getByText(/^Saved .*\.txt$/)).toBeVisible({ timeout: 15_000 });
  await shot('07-saved');
});

await step('settings: "Check for updates" works on Android', async () => {
  await page.evaluate(() => window.location.assign('/settings'));
  await expect(page.getByRole('button', { name: /Check for updates/ })).toBeVisible({
    timeout: 20_000,
  });
  await shot('08-settings');
  await page.getByRole('button', { name: /Check for updates/ }).click();
  await expect(
    page.getByText(/You have the latest version of Noted|Noted [\d.]+ is available/),
  ).toBeVisible({ timeout: 20_000 });
  await shot('09-update-check');
});

await step('no uncaught JavaScript errors', async () => {
  const fatal = jsErrors.filter((e) => e.startsWith('pageerror'));
  expect(fatal, fatal.join('\n')).toHaveLength(0);
});

const report = [...results, '', 'JS console errors:', ...(jsErrors.length ? jsErrors : ['(none)'])];
await writeFile(`${OUT}/results.txt`, `${report.join('\n')}\n`);
console.log(`\n${report.join('\n')}`);
await device.close();
process.exit(failed ? 1 : 0);
