import type { Locator, Page } from '@playwright/test';

export function composerButton(page: Page) {
  return page.getByRole('button', { name: /^Write something…?$/i });
}

export async function openNewEditor(page: Page) {
  await composerButton(page).click();
}

export async function closeEditor(page: Page) {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/notes');
}

export async function expandNavigationSection(navigation: Locator, name: 'Folders' | 'Tags') {
  const toggle = navigation.getByRole('button', { name, exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

export async function showNoteTools(page: Page) {
  const toggle = page.getByRole('button', { name: 'Note tools', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}
