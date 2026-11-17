import { expect, test } from '@playwright/test';
import { closeEditor, openNewEditor, showNoteTools } from './noteTools';

test('short notes fit a modest writing surface and long notes scroll', async ({ page }) => {
  await page.goto('/notes');
  await openNewEditor(page);
  const title = page.getByRole('textbox', { name: 'Note title' });
  const body = page.getByRole('textbox', { name: 'Note content' });
  const sheet = page.locator('.noted-focus-sheet');
  await expect(body).toBeFocused();
  const fontSize = await title.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  expect(fontSize).toBeLessThanOrEqual(34);
  expect(fontSize).toBeGreaterThanOrEqual(24);
  const size = await sheet.boundingBox();
  expect(size?.width).toBeLessThanOrEqual(850);
  expect(size?.height).toBeLessThan(360);

  await title.fill('Day notes');
  await body.fill(Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n'));
  await expect
    .poll(() =>
      page
        .locator('.noted-focus-scroll')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await closeEditor(page);
  await page.getByTestId('note-row').filter({ hasText: 'Day notes' }).click();
  await expect(body).toBeFocused();
  await expect(body).toContainText('Line 40');
});

test('browser back saves the latest typing before leaving the editor', async ({ page }) => {
  await page.goto('/notes');
  await openNewEditor(page);
  const text = 'Keep this revision during browser back';
  await page.getByRole('textbox', { name: 'Note content' }).fill(text);
  await page.goBack();
  await expect(page.getByTestId('note-list')).toBeVisible();
  await page.getByTestId('note-row').filter({ hasText: text }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(text);
});

test('image uploads and pasted images have compact thumbnails and preserve original files', async ({
  page,
}) => {
  await page.goto('/notes');
  const source = await page.evaluate(() =>
    [
      [350, 900],
      [1300, 480],
    ].map(([width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#092842';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#72cad7';
      ctx.fillRect(20, 20, 160, 100);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
  );
  await openNewEditor(page);
  await showNoteTools(page);
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  const attachments = page.getByRole('dialog', { name: 'Attachments', exact: true });
  await attachments.getByLabel('Attach files').setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source[0], 'base64'),
  });
  await expect(attachments.getByRole('button', { name: 'Preview portrait.png' })).toBeVisible();

  await attachments.evaluate((element, encoded) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(
        [Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))],
        'wide.png',
        {
          type: 'image/png',
        },
      ),
    );
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  }, source[1]);

  for (const [index, filename] of ['portrait.png', 'wide.png'].entries()) {
    const thumbnail = attachments.getByRole('button', { name: `Preview ${filename}`, exact: true });
    await thumbnail.scrollIntoViewIfNeeded();
    const thumbnailImg = thumbnail.locator('img');
    await expect
      .poll(() => thumbnailImg.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    expect(
      await thumbnailImg.evaluate((image: HTMLImageElement) =>
        Math.max(image.naturalWidth, image.naturalHeight),
      ),
    ).toBeLessThanOrEqual(96);
    expect((await thumbnail.boundingBox())?.height).toBeLessThanOrEqual(48);
    await thumbnail.focus();
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: `Preview ${filename}`, exact: true });
    const image = preview.getByRole('img', { name: filename });
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(96);
    const dimensions = await image.evaluate((element: HTMLImageElement) => {
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        ratio: element.naturalWidth / element.naturalHeight,
      };
    });
    expect(dimensions.width).toBeLessThan(dimensions.viewportWidth);
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight * 0.65 + 1);
    expect(dimensions.width / dimensions.height).toBeCloseTo(dimensions.ratio, 2);

    const downloading = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Download original' }).click();
    const stream = await (await downloading).createReadStream();
    const bytes: Buffer[] = [];
    for await (const chunk of stream) bytes.push(chunk as Buffer);
    expect(Buffer.concat(bytes).equals(Buffer.from(source[index], 'base64'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(thumbnail).toBeFocused();
  }
});
