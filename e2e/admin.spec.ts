import { test, expect } from '@playwright/test';
test('administrator routes require sign-in while Guest Mode and privacy controls remain usable', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto('/admin/transcription');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Ftranscription/);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Admin Dashboard' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.goto('/settings?section=privacy');
  const toggle = page.getByRole('switch', { name: 'Share operational statistics' });
  await expect(toggle).toHaveAttribute('data-state', 'unchecked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'checked');
  await page.reload();
  await expect(toggle).toHaveAttribute('data-state', 'checked');
  await toggle.click();
  await expect(
    page.getByRole('link', { name: 'Administrator dashboard', exact: true }),
  ).toHaveCount(0);
});
