import { test, expect, type Page } from '@playwright/test';
const mobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 768;
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
}
async function create(page: Page, title = 'Productivity', body = 'First thought') {
  const button = mobile(page)
    ? page.getByRole('button', { name: 'New note', exact: true }).first()
    : page.getByRole('navigation').getByRole('button', { name: 'New note' });
  await button.click();
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note content' }).fill(body);
  await saved(page);
}
async function saved(page: Page) {
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );
}
async function nav(page: Page) {
  if (mobile(page)) {
    await page.getByRole('button', { name: 'Back to notes list' }).click();
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  return page.getByRole('navigation');
}

test('rich formatting, checklist toggles, favorites, colors and duplication persist', async ({
  page,
}) => {
  await start(page);
  await create(page);
  const body = page.getByRole('textbox', { name: 'Note content' });
  await body.selectText();
  await page.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true }).click();
  await expect(body.locator('strong')).toHaveText('First thought');
  await saved(page);
  await page.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(body.locator('input[type=checkbox]')).toHaveCount(1);
  await body.locator('input[type=checkbox]').check();
  await expect(page.getByText(/1 of 1 tasks complete/)).toBeVisible();
  await saved(page);
  await page.getByRole('button', { name: 'Favorite note', exact: true }).click();
  await saved(page);
  await page.getByRole('radio', { name: 'Sage', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('radio', { name: 'Caveat', exact: true }).click();
  await expect(body).toHaveCSS('font-family', /Caveat/);
  await saved(page);
  await page.reload();
  await expect(body.locator('strong')).toHaveText('First thought');
  await expect(body.locator('input[type=checkbox]')).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Sage', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Remove favorite' })).toBeVisible();
  await expect(body).toHaveCSS('font-family', /Caveat/);
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Caveat', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate note' }).click();
  await expect(page.getByText(/Duplicated as/)).toBeVisible();
  const navigation = await nav(page);
  await navigation.getByRole('button', { name: /^Favorites/ }).click();
  await expect(page.getByTestId('note-row')).toHaveCount(2);
  await page.screenshot({
    path: `test-results/${mobile(page) ? 'mobile' : 'desktop'}-favorites.png`,
    fullPage: true,
  });
});

test('real attachments upload, download, reload and deletion', async ({ page }) => {
  await start(page);
  await create(page, 'Files');
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({
    name: 'private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Private attachment ✓'),
  });
  await expect(page.getByText('File attached', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download private.txt' }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString('utf8')).toBe('Private attachment ✓');
  await page.reload();
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download private.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete attachment private.txt' }).click();
  await expect(page.getByText('No attachments yet.')).toBeVisible();
});

test('reminders, notifications, unavailable AI, and real sharing notice', async ({ page }) => {
  await start(page);
  await create(page, 'Due task');
  await page.getByRole('button', { name: 'Reminder', exact: true }).click();
  await page.locator('input[type=datetime-local]').fill('2026-01-01T10:00');
  await page.getByRole('button', { name: 'Set reminder', exact: true }).click();
  await expect(page.getByText('Due / overdue')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByText('Reminder: Due task', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('AI is unavailable');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  // Guests cannot share: they are asked to log in instead of seeing sharing controls.
  const shareDialog = page.getByRole('dialog');
  await expect(shareDialog.getByRole('heading', { name: 'Log in to share notes' })).toBeVisible();
  await expect(shareDialog).toContainText('Sharing isn’t available in Guest Mode');
  await expect(shareDialog.getByLabel('Collaborator email')).toHaveCount(0);
  await expect(shareDialog.getByRole('button', { name: 'Share note' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reminder', exact: true }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Completed ·', { exact: false })).toBeVisible();
});

test('Markdown and DOCX documents import as genuine content', async ({ page }) => {
  await start(page);
  await page.getByTestId('import-txt-input').setInputFiles({
    name: 'Ideas.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# A heading\n\n**A bold idea**\n\n- [ ] A task'),
  });
  await page.getByTestId('note-row').filter({ hasText: 'Ideas' }).click();
  const body = page.getByRole('textbox', { name: 'Note content' });
  await expect(body.locator('h1')).toHaveText('A heading');
  await expect(body.locator('strong')).toHaveText('A bold idea');
  await page.getByRole('button', { name: 'More note actions' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export as DOCX' }).click();
  const download = await downloading;
  const file = await download.path();
  expect(file).toBeTruthy();
  await page.getByTestId('import-txt-input').setInputFiles({
    name: 'Returned.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await (await import('node:fs/promises')).readFile(file!),
  });
  if (mobile(page)) await page.getByRole('button', { name: 'Back to notes list' }).click();
  await page.getByTestId('note-row').filter({ hasText: 'Returned' }).click();
  await expect(body).toContainText('A bold idea');
});

test('offline app reload and edits survive reconnection', async ({ page, context }) => {
  await start(page);
  await create(page, 'Offline shell', 'Before offline');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  const body = page.getByRole('textbox', { name: 'Note content' });
  await expect(body).toHaveText('Before offline');
  await body.fill('Edited after an offline reload');
  await saved(page);
  await context.setOffline(false);
  await page.reload();
  await expect(body).toHaveText('Edited after an offline reload');
});

test('rich editor ignores active HTML in imported Markdown', async ({ page }) => {
  await start(page);
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await page.getByTestId('import-txt-input').setInputFiles({
    name: 'Untrusted.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>',
    ),
  });
  await page.getByTestId('note-row').filter({ hasText: 'Untrusted' }).click();
  await expect(
    page
      .getByRole('textbox', { name: 'Note content' })
      .locator('script,img,[onerror],a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(dialog).toBe(false);
});

test('PDF documents import readable text using the real PDF parser', async ({ page }) => {
  await start(page);
  const content = 'BT /F1 18 Tf 50 740 Td (PDF import verified) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page
    .getByTestId('import-txt-input')
    .setInputFiles({ name: 'Readable.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await page.getByTestId('note-row').filter({ hasText: 'Readable' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toContainText(
    'PDF import verified',
  );
});

test('folder appearance and linked-note navigation work after reload', async ({ page }) => {
  await start(page);
  await create(page, 'Target note');
  if (mobile(page)) await page.getByRole('button', { name: 'Back to notes list' }).click();
  await create(page, 'Source note');
  await page.getByRole('button', { name: 'Linked notes', exact: true }).click();
  await page.getByPlaceholder('Find a note to link…').fill('Target');
  await page.getByRole('dialog').getByRole('button', { name: 'Target note', exact: true }).click();
  await page.keyboard.press('Escape');
  await saved(page);
  await page.reload();
  const body = page.getByRole('textbox', { name: 'Note content' });
  const link = body.getByRole('link', { name: 'Target note' });
  await expect(link).toHaveAttribute('href', /^\/notes\//);
  await link.click({ modifiers: ['Control'] });
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Target note');
  await page.getByRole('button', { name: 'Linked notes', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Backlink from Source note', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const navigation = await nav(page);
  await navigation.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name').fill('Journal');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  if (mobile(page)) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Folder Journal options' }).click();
  await page.getByRole('menuitem', { name: 'Color & icon' }).click();
  await page.getByLabel('Folder color', { exact: true }).selectOption('violet');
  await page.getByLabel('Folder icon', { exact: true }).selectOption('book');
  await page.getByRole('button', { name: 'Save appearance' }).click();
  // The dialog closes only after the appearance is stored.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  if (mobile(page)) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Folder Journal options' }).click();
  await page.getByRole('menuitem', { name: 'Color & icon' }).click();
  await expect(page.getByLabel('Folder color', { exact: true })).toHaveValue('violet');
  await expect(page.getByLabel('Folder icon', { exact: true })).toHaveValue('book');
  await page.keyboard.press('Escape');
  await page.goto('/notes?dashboard=1');
  await expect(page.getByText('Welcome to Noted', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/${mobile(page) ? 'mobile' : 'desktop'}-dashboard.png`,
    fullPage: true,
  });
});
