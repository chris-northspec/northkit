import { expect, test } from '@playwright/test';
import { totpCode, totpStep } from '@northkit/core';
import { SETUP_PORT } from '../playwright.config';
import { alertWith, expectAccessible, expectNoSideways } from './helpers';

// S1-7: a fresh install sends everyone to set-up, which needs the one-time code (no
// default password anywhere). The new administrator must then turn on two-factor
// sign-in before anything else (S1-4). One empty database, so this runs once
// (desktop) and checks 390 x 844 on the way.
const base = `http://localhost:${SETUP_PORT}`;
test.use({ storageState: { cookies: [], origins: [] } });

test('first-run set-up on an empty install, then forced two-factor', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Set-up can only happen once per database.');

  await page.goto(`${base}/`);
  await expect(page).toHaveURL(`${base}/setup`);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up NorthKit' })).toBeVisible();
  await expect(page.getByLabel('Set-up code')).toBeFocused();
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideways(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  const password = 'first admin long password';
  await page.getByLabel('Set-up code').fill('WRONG-CODE-1234');
  await page.getByLabel('Organisation name').fill('Example Building Services Ltd');
  await page.getByLabel('Your name').fill('First Admin');
  await page.getByLabel('Email').fill('first.admin@setup.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password again').fill(password);
  await page.getByLabel('Depot reference').fill('nth1');
  await page.getByLabel('Depot name').fill('Northfield DC');
  await page.getByRole('button', { name: 'Finish set-up' }).click();
  await expect(alertWith(page, 'set-up code isn’t right')).toBeFocused();
  await expect(page.getByLabel('Depot name')).toHaveValue('Northfield DC');

  await page.getByLabel('Set-up code').fill(` ${process.env.E2E_SETUP_CODE!.toLowerCase()} `);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password again').fill(password);
  await page.getByRole('button', { name: 'Finish set-up' }).click();

  // Straight to two-factor: the Administrator role requires it.
  await expect(page).toHaveURL(`${base}/account/two-factor`);
  await expect(page.getByText('Your role needs two-factor sign-in')).toBeVisible();
  // Any other page sends them back here until it's done.
  await page.goto(`${base}/sites`);
  await expect(page).toHaveURL(`${base}/account/two-factor`);
  await page.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
  const secret = await page.getByLabel('Set-up key').getAttribute('data-secret');
  await expectAccessible(page);
  await page.getByLabel('Code from your app').fill(totpCode(secret!, totpStep()));
  await page.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
  await expect(page).toHaveURL(`${base}/`);
  await expect(page.getByRole('link', { name: /Example Building Services Ltd/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('NTH1');

  // Set-up is gone for good.
  expect((await page.goto(`${base}/setup`))?.status()).toBe(404);
});
