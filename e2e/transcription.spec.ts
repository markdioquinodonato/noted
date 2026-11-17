import { openNewEditor, showNoteTools } from './noteTools';
import { test, expect } from '@playwright/test';

function silentWav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(32000, 40);
  return bytes;
}
test('prepares real WAV, autosaves edits, restores, exports and deletes without sending guest audio', async ({
  page,
}) => {
  let externalAudioCalls = 0;
  page.on('request', (request) => {
    if (/functions\/v1\/transcribe|api.deepgram.com/.test(request.url())) externalAudioCalls++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await openNewEditor(page);
  await page.getByRole('textbox', { name: 'Note title' }).fill('Transcript test');
  await showNoteTools(page);
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(page.getByLabel('Transcription mode')).toHaveValue('strict');
  await page
    .getByLabel('Choose audio')
    .setInputFiles({ name: 'silence.wav', mimeType: 'audio/wav', buffer: silentWav() });
  await expect(page.getByText('silence.wav', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe audio', exact: true })).toBeDisabled();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  const segment = page.getByRole('textbox', { name: 'Transcript at 00:00:00.000' });
  await expect(segment).toHaveValue('[Unclear audio — review required]');
  await segment.fill('Actually, kanina pa ako naghihintay po.');
  await expect(page.getByText(/segments need review · Saved on this device/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await showNoteTools(page);
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(segment).toHaveValue('Actually, kanina pa ako naghihintay po.');
  await page.getByLabel('Playback speed').selectOption('0.75');
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.playbackRate),
  ).toBe(0.75);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export TXT', exact: true }).click();
  const stream = await (await downloading).createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  expect(text).toContain('INCOMPLETE TRANSCRIPT');
  expect(text).toContain('kanina pa');
  await page.getByRole('button', { name: 'Insert into note', exact: true }).click();
  await page.getByRole('button', { name: 'Delete recording & transcript', exact: true }).click();
  await expect(page.getByLabel('Choose audio')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText('kanina pa');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText('kanina pa');
  await showNoteTools(page);
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(page.getByLabel('Choose audio')).toBeVisible();
  expect(externalAudioCalls).toBe(0);
});
