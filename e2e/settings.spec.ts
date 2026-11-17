import { expect, test, type Page } from '@playwright/test';

async function selectCategory(page: Page, title: string) {
  const picker = page.getByRole('combobox', { name: 'Settings category' });
  if (await picker.isVisible()) {
    await picker.selectOption({ label: title });
  } else {
    await page
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('link', { name: title, exact: true })
      .click();
  }
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('profile opens organized settings and saves appearance and editor controls', async ({
  page,
}) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Autosave' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveCount(1);

  const layout = page.getByRole('combobox', { name: 'Default notes layout' });
  await layout.click();
  await page.getByRole('option', { name: 'Adaptive Board', exact: true }).click();
  await expect(layout).toHaveText('Adaptive Board');
  await selectCategory(page, 'Notes & Editor');
  const font = page.getByRole('combobox', { name: 'Font size' });
  await font.click();
  await page.getByRole('option', { name: '20px', exact: true }).click();
  await expect(font).toHaveText('20px');
  await expect(font).toBeEnabled();
  await page.reload();
  await expect(font).toHaveText('20px');
  await selectCategory(page, 'Appearance');
  await expect(layout).toHaveText('Adaptive Board');

  await selectCategory(page, 'Account');
  await expect(page).toHaveURL(/section=account/);
  await expect(page.getByRole('heading', { name: 'Guest Mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: /log out|sign out/i })).toHaveCount(0);
});

test('storage, permissions and release information are in separate working settings sections', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Headless Chromium on Windows can deny Notification even with a browser-context grant.
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => permission });
    Notification.requestPermission = async () => {
      permission = 'granted';
      return permission;
    };
  });
  await page.goto('/settings?section=storage');
  await expect(page.getByRole('heading', { name: 'Sync & Storage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import files' })).toBeVisible();
  await page.getByTestId('import-txt-input').setInputFiles({
    name: 'Settings import.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Saved through Sync & Storage.'),
  });
  await expect(page.getByText('Imported 1 note')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP' }).click();
  expect((await download).suggestedFilename()).toMatch(/^noted-export-.*\.zip$/i);
  await selectCategory(page, 'Notifications');
  await page.getByRole('button', { name: 'Enable browser notifications' }).click();
  await expect(page.getByText('Allowed', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View reminders' })).toHaveAttribute(
    'href',
    '/notes?view=reminders',
  );
  await selectCategory(page, 'About Noted');
  await expect(page.getByText(/^\d+\.\d+\.\d+$/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to notes' }).click();
  await expect(page.getByTestId('note-row').filter({ hasText: 'Settings import' })).toBeVisible();
});
