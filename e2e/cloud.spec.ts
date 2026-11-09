import { expect, test } from '@playwright/test';

/**
 * Account / cloud journeys. These require a dedicated Supabase TEST project
 * (never production) with email confirmation disabled for test users, and:
 *   E2E_SUPABASE=1
 *   VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in .env.e2e.local (test project)
 *   E2E_USER_A_EMAIL / E2E_USER_A_PASSWORD
 *   E2E_USER_B_EMAIL / E2E_USER_B_PASSWORD
 * They are skipped otherwise, and reported as skipped — not as passed.
 */
const enabled = process.env.E2E_SUPABASE === '1';
test.skip(!enabled, 'Requires a Supabase test project (set E2E_SUPABASE=1).');

const A = {
  email: process.env.E2E_USER_A_EMAIL ?? '',
  password: process.env.E2E_USER_A_PASSWORD ?? '',
};
const B = {
  email: process.env.E2E_USER_B_EMAIL ?? '',
  password: process.env.E2E_USER_B_PASSWORD ?? '',
};

async function login(page: import('@playwright/test').Page, u: typeof A) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password').fill(u.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/notes/);
}

test('login, cloud save, logout, and retrieval from a second device', async ({ browser }) => {
  const title = `Cloud ${Date.now()}`;
  const deviceA = await browser.newContext();
  const pageA = await deviceA.newPage();
  await login(pageA, A);
  await pageA
    .getByRole('navigation', { name: 'Notes navigation' })
    .getByRole('button', { name: 'New note' })
    .click();
  await pageA.getByRole('textbox', { name: 'Note title' }).fill(title);
  await pageA.getByRole('textbox', { name: 'Note content' }).fill('synced body');
  await expect(pageA.getByTestId('save-status').filter({ visible: true })).toContainText(
    'Saved to cloud',
  );

  const deviceB = await browser.newContext();
  const pageB = await deviceB.newPage();
  await login(pageB, A);
  await expect(pageB.getByTestId('note-list').getByText(title)).toBeVisible();

  // User B must not see User A's note.
  const deviceC = await browser.newContext();
  const pageC = await deviceC.newPage();
  await login(pageC, B);
  await pageC.getByRole('searchbox', { name: /search notes/i }).fill(title);
  await expect(pageC.getByTestId('note-row')).toHaveCount(0);

  // Logout
  await pageA.goto('/settings');
  await pageA.getByRole('button', { name: 'Log out' }).click();
  await expect(pageA).toHaveURL(/\/welcome/);
});

test('guest → account import of notes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  const title = `Guest ${Date.now()}`;
  await page
    .getByRole('navigation', { name: 'Notes navigation' })
    .getByRole('button', { name: 'New note' })
    .click();
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await expect(page.getByTestId('save-status').filter({ visible: true })).toHaveAttribute(
    'data-status',
    'saved',
  );
  await page.getByRole('button', { name: 'Save my notes to cloud' }).click();
  await page.getByRole('link', { name: 'Log in' }).click();
  await page.getByLabel('Email').fill(A.email);
  await page.getByLabel('Password').fill(A.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/import/);
  await page.getByRole('button', { name: /^Import \d+ note/ }).click();
  await expect(page.getByText('Import complete')).toBeVisible();
  // Re-import is a no-op (no duplicates)
  await page.goto('/import');
  await page.getByRole('checkbox', { name: 'Select all guest notes' }).check();
  await page.getByRole('button', { name: /^Import \d+ note/ }).click();
  await expect(page.getByTestId('import-summary')).toContainText('Imported0');
});
