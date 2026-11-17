import { expect, test } from '@playwright/test';
import {
  closeEditor,
  composerButton,
  expandNavigationSection,
  openNewEditor,
  showNoteTools,
} from './noteTools';

test('an untouched focus composer closes without leaving a blank note', async ({ page }) => {
  await page.goto('/notes');
  await expect(composerButton(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeHidden();
  await openNewEditor(page);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeFocused();
  await expect(page.getByTestId('note-list')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Notes navigation' })).toBeHidden();
  await closeEditor(page);
  await expect(page).toHaveURL('/notes');
  await expect(page.getByTestId('note-row')).toHaveCount(0);
  await expect(composerButton(page)).toBeFocused();
  await page.reload();
  await expect(composerButton(page)).toBeVisible();
  await expect(page.getByTestId('note-row')).toHaveCount(0);
});

test('the editor toolbar and Done fit at phone widths', async ({ page }) => {
  await page.goto('/notes');
  await openNewEditor(page);
  const controls = [
    page.getByRole('button', { name: 'Format text', exact: true }),
    page.getByRole('button', { name: 'Note tools', exact: true }),
    page.getByRole('button', { name: 'More note actions', exact: true }),
    page.getByRole('button', { name: 'Done', exact: true }),
  ];
  for (const width of [412, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() => control.evaluate((element) => element.getBoundingClientRect().right))
        .toBeLessThanOrEqual(width);
    }
  }
  await closeEditor(page);
  await expect(composerButton(page)).toBeVisible();
});

test('Done saves typing immediately and reopens the note without library distractions', async ({
  page,
}) => {
  await page.goto('/notes');
  await openNewEditor(page);

  // A body-only note can be saved before the autosave debounce completes.
  const body = page.getByRole('textbox', { name: 'Note content', exact: true });
  const content = 'Kumusta ang team?\nBring <two> cameras.';
  await body.fill(content);
  await closeEditor(page);

  const notes = page.getByTestId('note-row');
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toContainText('Kumusta ang team?');
  await page.reload();
  await notes.first().click();
  await expect(page.getByTestId('note-list')).toBeHidden();
  await expect(page.getByRole('searchbox', { name: /search notes/i })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Notes navigation' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('');
  await expect(body).toHaveText(content, { useInnerText: true });
  await closeEditor(page);
  await expect(notes.first()).toBeFocused();
});

test('leaving the editor restores the selected folder and notes search', async ({ page }) => {
  await page.goto('/notes');
  const mobile = (page.viewportSize()?.width ?? 1366) < 1024;
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Notes navigation' });
  await expandNavigationSection(navigation, 'Folders');
  await navigation.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name').fill('Field notes');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('list-heading')).toHaveText('Field notes');
  const folderUrl = page.url();

  await openNewEditor(page);
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Mangrove survey');
  await page
    .getByRole('textbox', { name: 'Note content', exact: true })
    .fill('Find the trail at low tide.');
  await closeEditor(page);
  await expect(page).toHaveURL(folderUrl);
  const search = page.getByRole('searchbox', { name: /search notes/i });
  await search.fill('low tide');
  await page.getByTestId('note-row').filter({ hasText: 'Mangrove survey' }).click();
  await expect(page.getByTestId('note-list')).toBeHidden();
  await closeEditor(page);
  await expect(page).toHaveURL(folderUrl);
  await expect(search).toHaveValue('low tide');
  await expect(page.getByTestId('note-row')).toHaveCount(1);
});

test('checklists and deeper focus preserve the same note and formatting disclosure', async ({
  page,
}) => {
  await page.goto('/notes');
  await openNewEditor(page);
  const title = page.getByRole('textbox', { name: 'Note title', exact: true });
  const body = page.getByRole('textbox', { name: 'Note content', exact: true });
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });

  await title.fill('Packing');
  await title.press('Enter');
  await expect(body).toBeFocused();
  await expect(toolbar).toBeHidden();
  await page.getByRole('button', { name: 'Format text', exact: true }).click();
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Checklist', exact: true }).click();
  await page.keyboard.type('Bring charger');
  await expect(body.locator('li p')).toHaveText('Bring charger');
  await body.locator('input[type=checkbox]').check();

  const more = page.getByRole('button', { name: 'More note actions', exact: true });
  await more.click();
  await page.getByRole('menuitem', { name: 'Focus writing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit focus writing', exact: true })).toBeVisible();
  await expect(body).toBeFocused();
  await expect(toolbar).toBeHidden();
  await expect(page.getByTestId('note-list')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(toolbar).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(title).toHaveValue('Packing');
  await expect(body.locator('input[type=checkbox]')).toBeChecked();
  await closeEditor(page);
  await expect(page.getByTestId('note-row').filter({ hasText: 'Packing' })).toContainText(
    'Bring charger',
  );
});

test('the dedicated editor reveals advanced tools on request', async ({ page }) => {
  await page.goto('/notes');
  await openNewEditor(page);
  const titles = [
    ['Voice', 'Voice'],
    ['Scan text with camera', 'Scan text with camera'],
    ['Attachments', 'Attachments'],
    ['Reminder', 'Reminder'],
    ['Note color', 'Note color'],
  ];

  for (const [tool] of titles) {
    if (tool !== 'Note color') {
      await expect(page.getByRole('button', { name: tool, exact: true })).toBeHidden();
    }
  }
  for (const [tool, title] of titles) {
    await showNoteTools(page);
    await page.getByRole('button', { name: tool, exact: true }).click();
    await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
  }
});

test('primary navigation keeps Folders and Tags and the profile owns account actions', async ({
  page,
}) => {
  await page.goto('/notes');
  const mobile = (page.viewportSize()?.width ?? 1024) < 1024;
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Notes navigation' });
  for (const name of ['Notes', 'Reminders', 'Shared', 'Archive', 'Trash'])
    await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: /account|download/i })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

  for (const [section, action] of [
    ['Folders', 'New folder'],
    ['Tags', 'New tag'],
  ]) {
    const disclosure = navigation.getByRole('button', { name: section, exact: true });
    const create = navigation.getByRole('button', { name: action, exact: true });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(create).toBeHidden();
    await disclosure.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(create).toBeVisible();
  }

  if (mobile) await page.keyboard.press('Escape');
  const profile = page.getByRole('button', { name: 'Profile', exact: true });
  await expect(profile).toHaveCount(1);
  await profile.press('Enter');
  const menu = page.getByRole('menu', { name: 'Profile', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Download Noted' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(profile).toBeFocused();
  await profile.click();
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();
  await profile.click();
  await menu.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(profile).toHaveCount(1);
});

test('collapsed desktop sidebar keeps icons, tooltips and destinations available', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, 'Desktop sidebar preference');
  await page.goto('/notes');
  const navigation = page.getByRole('navigation', { name: 'Notes navigation' });
  await navigation.getByRole('button', { name: 'Collapse sidebar' }).click();
  const archive = navigation.getByRole('button', { name: 'Archive', exact: true });
  for (const name of ['Notes', 'Reminders', 'Shared', 'Archive', 'Trash']) {
    const destination = navigation.getByRole('button', { name, exact: true });
    await expect(destination).toBeVisible();
    await expect(destination).toHaveText('');
  }
  await archive.focus();
  await expect(page.getByRole('tooltip', { name: 'Archive' })).toBeVisible();
  await archive.press('Enter');
  await expect(archive).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('list-heading')).toHaveText('Archive');
  await page.reload();
  await expect(navigation.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(archive).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Folders', exact: true }).click();
  const folders = page.getByRole('dialog', { name: 'Folders' });
  await folders.getByRole('button', { name: 'Uncategorized' }).click();
  await expect(folders).toBeHidden();
  await expect(page.getByTestId('list-heading')).toHaveText('Uncategorized');
  await navigation.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(archive).toHaveText('Archive');
});

test('Done returns the Notes library to the same scroll position', async ({ page }) => {
  await page.goto('/notes');
  await page.getByTestId('import-txt-input').setInputFiles(
    Array.from({ length: 28 }, (_, index) => ({
      name: 'Library entry ' + (index + 1) + '.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Example content for this library entry.'),
    })),
  );
  const rows = page.getByTestId('note-row');
  await expect(rows).toHaveCount(28);
  const list = page.getByTestId('note-list');
  const before = await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await rows.last().click();
  await expect(list).toBeHidden();
  await closeEditor(page);
  await expect(list).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(before);
});
