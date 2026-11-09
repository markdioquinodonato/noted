import { test, expect } from '@playwright/test';
// Browser APIs receive Chromium's synthetic microphone, without accessing real hardware.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});
test('records, pauses, previews and persistently attaches real audio bytes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('Voice journal');
  await page.getByRole('textbox', { name: 'Note content' }).fill('Audio from the browser recorder');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText('Microphone recording…')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Microphone paused…')).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Save recording to note', exact: true }).click();
  await expect(page.getByText('Voice recording attached', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  const button = page.getByRole('button', { name: /Download Voice-/ });
  await expect(button).toBeVisible();
  const downloading = page.waitForEvent('download');
  await button.click();
  const file = await downloading;
  const stream = await file.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += (chunk as Buffer).length;
  expect(bytes).toBeGreaterThan(100);
});
