import { expect, test } from '@playwright/test';
import { createPool } from '@northkit/db';
import { E2E_DB_NAME } from '../playwright.config';
import { E2E } from './global-setup';
import { totpCode, totpStep } from '@northkit/core';
import { expectAccessible, openMenu, password, projectKey, ready, runTag, signIn } from './helpers';

// S1-5: a Kit Manager at depot A sees nothing of depot B (acceptance test: site
// isolation, in the screens). S1-4: an administrator without two-factor is held at set-up;
// role switches take effect at once.

test.describe('as a Kit Manager at depot A', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees only depot A, and depot B pages are not found', async ({ page }) => {
    await signIn(page, E2E.manager);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E-A · Alderbank depot');
    await openMenu(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Roles and access' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.goto('/sites');
    await expect(page.getByRole('link', { name: 'E2E-A' })).toBeVisible();
    await expect(page.getByText('E2E-B')).toHaveCount(0);

    // Depot B's id, from the database, tried directly in the address bar.
    const pool = createPool('admin', { database: E2E_DB_NAME, max: 1 });
    const siteB = (
      await pool.query<{ id: string }>(`SELECT id FROM core.sites WHERE code = 'E2E-B'`)
    ).rows[0]!.id;
    await pool.end();
    // The page streams (it has a loading state), so the status is sent before the
    // not-found is known; what matters is that nothing of depot B is shown.
    for (const path of [`/sites/${siteB}`, `/sites/${siteB}/locations`]) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Page not found' }),
        path,
      ).toBeVisible();
      await expect(page.getByText('Birchmoor')).toHaveCount(0);
    }
    await expectAccessible(page);
  });
});

test.describe('an administrator without two-factor', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is held at two-factor set-up from every page', async ({ page }, info) => {
    await signIn(page, E2E.newAdmin(info.project.name));
    await expect(page).toHaveURL('/account/two-factor');
    for (const path of ['/', '/users', '/settings', '/sites']) {
      await page.goto(path);
      await expect(page).toHaveURL('/account/two-factor');
    }
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    // Once it's set up, the menu is there straight away, with no reload.
    await page.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
    const secret = await page.getByLabel('Set-up key').getAttribute('data-secret');
    await page.getByLabel('Code from your app').fill(totpCode(secret!, totpStep()));
    await page.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
    await expect(page).toHaveURL('/');
    await openMenu(page);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }),
    ).toBeVisible();
  });
});

test.describe('a user who must change their password', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('gets the menu straight after changing it, with no reload', async ({ page }, info) => {
    await signIn(page, E2E.mustChange(info.project.name));
    await expect(page).toHaveURL('/change-password');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    const fresh = `New ${runTag()} long enough passphrase ${runTag()}`;
    await page.getByLabel('Current password').fill(password());
    await page.getByLabel('New password', { exact: true }).fill(fresh);
    await page.getByLabel('New password again').fill(fresh);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL('/');
    await openMenu(page);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' }),
    ).toBeVisible();
  });
});

test('switching a role’s switch on and off changes what its holder can do', async ({
  page,
  browser,
}, info) => {
  const project = info.project.name;
  const viewer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const viewerPage = await viewer.newPage();
  await signIn(viewerPage, E2E.viewer(project));
  await expect(viewerPage).toHaveURL('/');
  await viewerPage.goto('/sites');
  await expect(viewerPage.getByRole('link', { name: 'Add a depot' })).toHaveCount(0);

  // The administrator turns on Settings: Create for the viewer's role.
  const openRole = async () => {
    await page.goto('/roles');
    await page.getByRole('link', { name: `E2E viewer ${project}` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`E2E viewer ${project}`);
    await ready(page);
  };
  await openRole();
  await page.getByLabel('Settings: Create').check();
  await page.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByText('Role saved.')).toBeVisible();

  await viewerPage.goto('/sites');
  await viewerPage.getByRole('link', { name: 'Add a depot' }).click();
  const code = `V${runTag()}${projectKey(info).slice(0, 2).toUpperCase()}`;
  await viewerPage.getByLabel('Depot reference').fill(code);
  await viewerPage.getByLabel('Depot name').fill('Viewer made this');
  await viewerPage.getByRole('button', { name: 'Add depot' }).click();
  await expect(viewerPage.getByRole('heading', { level: 1 })).toContainText(code);

  // And off again: the button goes.
  await openRole();
  await expect(page.getByText('Role saved.')).toHaveCount(0);
  await page.getByLabel('Settings: Create').uncheck();
  await page.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByText('Role saved.')).toBeVisible();
  await viewerPage.goto('/sites');
  await expect(viewerPage.getByRole('link', { name: 'Add a depot' })).toHaveCount(0);
  await viewerPage.goto('/sites/new');
  await expect(viewerPage).toHaveURL('/');
  await viewer.close();
});
