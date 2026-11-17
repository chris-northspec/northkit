import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoSideways, expectTouchTargets, openMenu } from './helpers';

// S1-9: the app shell (sidebar, depot filter, overview) and the main screens pass
// WCAG 2.2 AA checks (axe) with no sideways scrolling and 44 px targets, at 1280 wide
// and on a 390 x 844 phone. Runs as each project's administrator.

const PAGES = ['/', '/sites', '/users', '/roles', '/audit', '/settings', '/account'];

test('main screens are accessible and fit the screen', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSideways(page);
    await expectAccessible(page);
  }
  await page.goto('/');
  await expectTouchTargets(page);
});

test('depot pages are accessible: details, locations', async ({ page }) => {
  await page.goto('/sites');
  await page.getByRole('link', { name: 'E2E-A' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Alderbank depot');
  await expectAccessible(page);
  await expectNoSideways(page);
  await page.getByRole('link', { name: 'Locations', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Locations at E2E-A');
  await expectAccessible(page);
  await expectNoSideways(page);
});

// The overview, in the house style: four stat cards, then the depots table beside a Needs
// action panel. The figures are the ones global-setup makes: three depots, four locations
// (a store and two vans at A, a van at B), and depot C empty.
test('the overview shows the stat cards, the depots table and what needs action', async ({
  page,
}) => {
  await page.goto('/');
  const cards = page.locator('.kpis');
  await expect(cards.getByRole('link', { name: /^Depots 3/ })).toBeVisible();
  await expect(cards.getByRole('link', { name: /^Locations 4/ })).toBeVisible();
  await expect(cards.getByRole('link', { name: /^Vans 3/ })).toBeVisible();
  await expect(cards.getByRole('link', { name: /^People/ })).toBeVisible();
  await expect(page.locator('.table-wrap')).toContainText('E2E-C');
  const needs = page
    .getByRole('region', { name: 'Needs action' })
    .or(page.locator('section.needs-action'));
  await expect(needs).toContainText('E2E-C · Cedarfield depot has no stores, vans or yards yet');
  await expectAccessible(page);
});

test('the menu and the depot filter work', async ({ page }) => {
  await page.goto('/');
  await openMenu(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Depots and locations' })
    .click();
  await expect(page).toHaveURL('/sites');
  // On a phone the menu folds away after a link; open it to see where we are.
  await openMenu(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Depots and locations' }),
  ).toHaveAttribute('aria-current', 'page');

  // Choosing a depot narrows the overview to it, and stays chosen.
  await page.goto('/');
  await page
    .getByLabel('Depot', { exact: true })
    .selectOption({ label: 'E2E-B · Birchmoor depot' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E-B · Birchmoor depot');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E-B · Birchmoor depot');
  await page.getByLabel('Depot', { exact: true }).selectOption({ index: 0 });
  // An administrator works at every depot, so "all" says so.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('All depots');
  await expectAccessible(page);
});
