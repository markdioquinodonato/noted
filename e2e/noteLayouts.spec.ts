import { expect, test, type Page } from '@playwright/test';
import { closeEditor, composerButton, openNewEditor } from './noteTools';

async function note(page: Page, title: string, text: string) {
  await openNewEditor(page);
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note content' }).fill(text);
  await closeEditor(page);
}

test('the composer stays centered above the notes with collection controls visible', async ({
  page,
}) => {
  await page.goto('/notes?uncategorized=1');
  const composer = composerButton(page);
  const bar = page.locator('.noted-list-command-bar');
  const clearFilter = page.getByRole('button', { name: 'Clear collection filter', exact: true });
  const viewOptions = page.getByRole('button', { name: 'View options', exact: true });
  await expect(clearFilter).toBeVisible();
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(composer).toBeInViewport({ ratio: 1 });
    const button = (await composer.boundingBox())!;
    const row = (await bar.boundingBox())!;
    const view = (await viewOptions.boundingBox())!;
    expect(button.x + button.width / 2).toBeCloseTo(row.x + row.width / 2, 0);
    expect(view.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(view.x + view.width).toBeLessThanOrEqual(row.x + row.width + 1);
  }
  await composer.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeFocused();
});

test('four note layouts change the actual cards and remember the selected view', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: page.viewportSize()!.width < 768 ? 'dark' : 'light' });
  await page.goto('/notes');
  const composer = composerButton(page);
  await expect(composer).toBeVisible();
  const bounds = (await composer.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(688);
  expect(bounds.height).toBeGreaterThanOrEqual(44);

  await note(page, 'Field brief', 'Packing list.');
  await note(
    page,
    'Field report',
    'The weather cleared in the morning and we walked the whole trail. '.repeat(6),
  );
  await note(page, 'Other ideas', 'Book a meeting.');

  const search = page.getByRole('searchbox', { name: /search notes/i });
  await search.fill('Field');
  const cards = page.getByTestId('note-row');
  await expect(cards).toHaveCount(2);

  const list = page.locator('ul.noted-index');
  const names = list.locator('.noted-index-title');
  const order = await names.allTextContents();
  const brief = page.locator('.noted-index-card').filter({ hasText: 'Field brief' });
  const report = page.locator('.noted-index-card').filter({ hasText: 'Field report' });
  const comfortable = (await brief.boundingBox())!.height;
  const options = page.getByRole('button', { name: 'View options', exact: true });

  for (const [label, layout] of [
    ['Compact Grid', 'compact'],
    ['Clean List', 'list'],
    ['Adaptive Board', 'board'],
    ['Comfortable Grid', 'grid'],
  ]) {
    await options.press('Enter');
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await expect(list).toHaveAttribute('data-layout', layout);
    await expect(names).toHaveText(order);
    await expect(search).toHaveValue('Field');

    const short = (await brief.boundingBox())!;
    const long = (await report.boundingBox())!;
    if (layout === 'compact') expect(short.height).toBeLessThan(comfortable);
    if (layout === 'list') {
      const listBounds = (await list.boundingBox())!;
      expect(short.width).toBeCloseTo(listBounds.width, 0);
      expect(short.x).toBeCloseTo(long.x, 0);
    }
    if (layout === 'board') expect(long.height).toBeGreaterThan(short.height);
  }

  await options.click();
  await page.getByRole('menuitemradio', { name: 'Adaptive Board', exact: true }).click();
  await page.reload();
  await expect(list).toHaveAttribute('data-layout', 'board');
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: 'Actions for Field brief', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeVisible();
});
