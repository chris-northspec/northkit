import { expect, test } from '@playwright/test';
import { expectAccessible, ready } from './helpers';

// S7-7 (X-4): the audit log screen with filters by person, record type, site and date,
// and its CSV, which carries the same filters. Axe at both sizes.

test('the audit log filters, and downloads what it shows as CSV', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Audit log');
  await ready(page);
  await expectAccessible(page);

  await page.getByLabel('Record type').selectOption('core.sites');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  await page.getByLabel('To').fill(today);
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/type=core\.sites/);
  await expect(page.locator('.list-count')).toHaveText(/entr(y|ies)/);
  await expect(
    page
      .getByRole('cell')
      .filter({ hasText: /^core\.sites\./ })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: /^core\.users\./ })).toHaveCount(0);

  const href = await page.getByRole('link', { name: 'Download as CSV' }).getAttribute('href');
  expect(href).toContain('type=core.sites');
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const lines = (await csv.text()).trim().split('\r\n');
  expect(lines[0]).toMatch(/^when_utc,when_uk,who,who_email,action,record_type,/);
  expect(lines.slice(1).every((l) => l.includes(',core.sites,'))).toBe(true);
  await expectAccessible(page);
});
