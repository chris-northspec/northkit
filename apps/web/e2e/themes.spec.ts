import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoSideways, ready } from './helpers';

// The brand release (K9, K31): Hi-Vis Yellow is a light accent with Ink text on it. Axe
// (WCAG 2.2 AA, including colour contrast) runs on the main screens in BOTH colour schemes
// at both sizes, and the primary button really is Ink on yellow.

for (const scheme of ['light', 'dark'] as const) {
  test(`the main screens pass axe in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of [
      '/',
      '/items',
      '/items/new',
      '/kinds',
      '/import',
      '/sites',
      '/users',
      '/settings',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await ready(page);
      await expectNoSideways(page);
      await expectAccessible(page);
    }
  });
}

test('the primary button is Ink on Hi-Vis Yellow, never white', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/items');
  const button = page.getByRole('link', { name: 'Add an item' });
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  expect(style).toEqual({ color: 'rgb(27, 31, 36)', background: 'rgb(242, 194, 0)' });
});

test('the sign-in page and the scan page pass axe in dark mode', async ({ browser }) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto('/login');
  await ready(page);
  await expectAccessible(page);
  await page.goto('/i/not-a-real-label');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Label not recognised');
  await expectAccessible(page);
  await context.close();
});
