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

/** Leave any system UI (pickers, dialogs) so the app's activity is resumed again. */
async function ensureForeground() {
  for (let i = 0; i < 3; i++) {
    const focus = await shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp" || true');
    if (
      focus.includes(`${PKG}/${PKG}.MainActivity`) &&
      !/documentsui|Application Not Responding/i.test(focus)
    )
      return;
    await shell('input keyevent 4');
    await sleep(1500);
  }
}

async function step(name, fn) {
  await ensureForeground();
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
  // System "Save to" picker (DocumentsUI) — confirm with its SAVE button, found via
  // a UI Automator dump (works without Playwright's helper APKs).
  let bounds = null;
  for (let i = 0; i < 20 && !bounds; i++) {
    await sleep(1000);
    const xml = await shell('uiautomator dump /sdcard/ui.xml > /dev/null && cat /sdcard/ui.xml');
    const node = xml
      .split('<node ')
      .find(
        (n) => /package="com\.(google\.)?android\.documentsui"/.test(n) && /text="SAVE"/i.test(n),
      );
    const m = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) bounds = m.slice(1).map(Number);
  }
  if (!bounds) throw new Error('Android save picker with a SAVE button did not appear');
  await shot('06-save-dialog');
  const [x1, y1, x2, y2] = bounds;
  await shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
  await expect(page.getByText(/^Saved .*\.txt$/)).toBeVisible({ timeout: 15_000 });
  await shot('07-saved');
});

await step('settings: "Check for updates" works on Android', async () => {
  await page.keyboard.press('Escape');
  await page.goto(new URL('/settings', page.url()).href);
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

await step('status/navigation bar strips follow the app theme (dark mode)', async () => {
  await page.evaluate(() => localStorage.setItem('noted:theme', 'dark'));
  await page.reload();
  await expect(page.locator('html.dark')).toHaveCount(1, { timeout: 20_000 });
  await sleep(1500);
  await shot('10-dark-mode');
  // Raw screencap: 16-byte header (w, h, format, colorspace) then RGBA pixels.
  const raw = await device.shell('screencap');
  const w = raw.readUInt32LE(0);
  const h = raw.readUInt32LE(4);
  const px = (x, y) => [...raw.subarray(16 + (y * w + x) * 4, 16 + (y * w + x) * 4 + 3)];
  for (const [name, [r, g, b]] of [
    ['status bar', px(Math.round(w / 2), 8)],
    ['navigation bar', px(20, h - 8)],
  ]) {
    console.log(`${name} pixel: rgb(${r}, ${g}, ${b})`);
    expect(r + g + b, `${name} should be dark, got rgb(${r}, ${g}, ${b})`).toBeLessThan(150);
  }
  await page.evaluate(() => localStorage.setItem('noted:theme', 'system'));
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
