import { expect, test, type Page } from '@playwright/test';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 768;

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(page).toHaveURL(/\/notes\?dashboard=1$/);
}

async function newNote(page: Page, title: string, body: string, opts: { autosave?: boolean } = {}) {
  if (isMobile(page))
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  else
    await page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'New note' })
      .click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note content' }).fill(body);
  if (opts.autosave === false) await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 5000 },
  );
}

async function backToList(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Back to notes list' }).click();
}

async function openNav(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Open navigation' }).click();
  return page.getByRole('navigation', { name: 'Notes navigation' });
}

test('guest can write without an account and notes survive a reload', async ({ page }) => {
  await startAsGuest(page);
  await newNote(page, 'Reload test ✓', 'Ünïcödé line one\nline two 日本語');
  await page.reload();
  if (isMobile(page)) {
    await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
      'Ünïcödé line one\nline two 日本語',
      { useInnerText: true },
    );
    await backToList(page);
  }
  await expect(page.getByTestId('note-list').getByText('Reload test ✓')).toBeVisible();
  // Fully close the browser context's page and reopen.
  const page2 = await page.context().newPage();
  await page.close();
  await page2.goto('/notes');
  await expect(page2.getByTestId('note-list').getByText('Reload test ✓')).toBeVisible();
});

test('edit, search, archive, trash, restore and permanent delete', async ({ page }) => {
  await startAsGuest(page);
  await newNote(page, 'Alpha', 'quick brown fox');
  await backToList(page);
  await newNote(page, 'Beta', 'lazy dog');
  await backToList(page);

  // Search by content
  await page.getByRole('searchbox', { name: /search notes/i }).fill('brown');
  await expect(page.getByTestId('note-row')).toHaveCount(1);
  await expect(page.getByTestId('note-row')).toContainText('Alpha');
  await page.getByRole('searchbox', { name: /search notes/i }).fill('');
  await expect(page.getByTestId('note-row')).toHaveCount(2);

  // Archive Alpha
  await page.getByTestId('note-row').filter({ hasText: 'Alpha' }).click();
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('Archived — hidden from your main notes.')).toBeVisible();
  await backToList(page);
  await expect(page.getByTestId('note-row')).toHaveCount(1);
  let nav = await openNav(page);
  await nav.getByRole('button', { name: /^Archive/ }).click();
  await expect(page.getByTestId('list-heading')).toHaveText('Archive');
  await expect(page.getByTestId('note-row')).toContainText('Alpha');

  // Trash Beta, then restore
  nav = await openNav(page);
  await nav.getByRole('button', { name: /^All Notes/ }).click();
  await page.getByTestId('note-row').filter({ hasText: 'Beta' }).click();
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(page.getByTestId('note-row')).toHaveCount(0);
  nav = await openNav(page);
  await nav.getByRole('button', { name: /^Trash/ }).click();
  await page.getByTestId('note-row').filter({ hasText: 'Beta' }).click();
  await expect(page.getByText('This note is in Trash.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByText('This note is in Trash.')).toBeHidden();

  // Trash again, then delete forever (with confirmation)
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByTestId('note-row').filter({ hasText: 'Beta' }).click();
  await page.getByRole('button', { name: 'Delete forever' }).first().click();
  await expect(page.getByRole('alertdialog')).toContainText('can’t be undone');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete forever' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});

test('folders, tags, filters and folder deletion keeps notes', async ({ page }) => {
  await startAsGuest(page);
  let nav = await openNav(page);
  await nav.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Folder name').fill('Work');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('list-heading')).toHaveText('Work');
  if (isMobile(page))
    await expect(page.getByRole('navigation', { name: 'Notes navigation' })).toBeHidden();

  await newNote(page, 'Quarterly plan', 'Goals for Q3');
  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByPlaceholder('Find or create a tag…').fill('planning');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByText('#planning').first()).toBeVisible();
  await backToList(page);

  // Duplicate folder names are rejected
  nav = await openNav(page);
  await nav.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Folder name').fill('  work ');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await page.keyboard.press('Escape');

  // Filter by tag
  nav = await openNav(page);
  await nav.getByRole('button', { name: /^planning/ }).click();
  await expect(page.getByTestId('note-row')).toHaveCount(1);

  // Delete the folder: the note survives as uncategorized
  nav = await openNav(page);
  await nav.getByRole('button', { name: 'Folder Work options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('will not be deleted');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete folder' }).click();
  nav = await openNav(page);
  await nav.getByRole('button', { name: /^Uncategorized/ }).click();
  await expect(page.getByTestId('note-row').filter({ hasText: 'Quarterly plan' })).toBeVisible();
});

test('version history: checkpoint with Ctrl+S and restore', async ({ page }) => {
  await startAsGuest(page);
  await newNote(page, 'Versioned', 'first draft');
  await page.getByRole('textbox', { name: 'Note content' }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText(/checkpoint created/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Note content' }).fill('second draft');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );

  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await page.getByRole('button', { name: /Version 1/ }).click();
  await expect(page.getByRole('dialog').locator('pre')).toHaveText('first draft');
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText('first draft');

  // The replaced text was preserved as a new version.
  await page.getByRole('button', { name: 'More note actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await page.getByRole('button', { name: /Version 2/ }).click();
  await expect(page.getByRole('dialog').locator('pre')).toHaveText('second draft');
});

test('unsaved edits survive a refresh (draft recovery) when autosave is off', async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/settings');
  await page.getByRole('switch', { name: 'Autosave' }).click();
  await expect(page.getByRole('switch', { name: 'Autosave' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.goto('/notes');
  await newNote(page, 'Draft safety', 'saved part', { autosave: false });
  // newNote waits for the initial save; type more without saving.
  await page.getByRole('textbox', { name: 'Note content' }).fill('saved part + unsaved tail');
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'unsaved',
  );
  await page.waitForTimeout(500); // allow the local draft mirror (300 ms debounce)
  page.on('dialog', (d) => void d.accept()); // beforeunload warning
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    'saved part + unsaved tail',
  );
  await expect(page.getByText('Recovered unsaved changes from this device.')).toBeVisible();
});

test('import TXT files and export a note as TXT', async ({ page }) => {
  await startAsGuest(page);
  await page.getByTestId('import-txt-input').setInputFiles([
    {
      name: 'Imported ✓.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('﻿Line 1\r\nLíne 2 日本語\r\n', 'utf8'),
    },
    { name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') },
  ]);
  await expect(page.getByText('Imported 1 note')).toBeVisible();
  await expect(page.getByText(/is not a \.txt file/)).toBeVisible();
  await page.getByTestId('note-row').filter({ hasText: 'Imported ✓' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    'Line 1\nLíne 2 日本語\n',
    { useInnerText: true },
  );

  await page.getByRole('button', { name: 'More note actions' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export as .txt' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Imported ✓.txt');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString('utf8')).toBe('Line 1\nLíne 2 日本語\n');
});

test('theme switching: light, dark and persisted preference', async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('works offline in guest mode and shows an offline banner', async ({ page, context }) => {
  await startAsGuest(page);
  await context.setOffline(true);
  await expect(page.getByText(/You’re offline/)).toBeVisible();
  await newNote(page, 'Offline note', 'written without network');
  await context.setOffline(false);
  await expect(page.getByText(/You’re offline/)).toBeHidden();
});

test('layout has no horizontal overflow and is keyboard navigable', async ({ page }) => {
  await startAsGuest(page);
  await newNote(page, 'Layout', 'x');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await backToList(page);
  // Ctrl/Cmd+F inside the note body is left to the browser; elsewhere it focuses note search.
  const search = page.getByRole('searchbox', { name: /search notes/i });
  await expect(search).toBeVisible();
  await page.getByTestId('list-heading').click();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByRole('searchbox', { name: /search notes/i })).toBeFocused();
});

test('Enter in the title moves typing straight into the note body', async ({ page }) => {
  await startAsGuest(page);
  if (isMobile(page))
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  else
    await page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'New note' })
      .click();
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.click();
  await page.keyboard.type('Quick title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('body text typed immediately');
  await expect(title).toHaveValue('Quick title');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    'body text typed immediately',
  );
});

test('Alt+N creates a new note from anywhere in the workspace', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) < 768, 'keyboard shortcut is desktop-only');
  await startAsGuest(page);
  // Wait until the workspace (and its shortcut listener) is on screen, as a user would.
  await expect(page.getByRole('navigation', { name: 'Notes navigation' })).toBeVisible();
  await page.keyboard.press('Alt+n');
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeFocused();
});
