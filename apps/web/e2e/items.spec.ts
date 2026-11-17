import { expect, test, type Page } from '@playwright/test';
import { ITEM_IMPORT_COLUMNS, signItemCode } from '@northkit/core';
import { expectAccessible, expectNoSideways, projectKey, ready, runTag } from './helpers';
import { jpegPhoto } from './photo';

// Sprint 2 journeys (acceptance A15, A21 to A25), at both sizes, with axe: create an item,
// print its label and scan it signed in; scan with no login; import with errors then a clean
// import; a kit set; photo upload on the phone; the screens themselves.

const DEPOT = 'E2E-A · Alderbank depot';

async function addItem(
  page: Page,
  fields: { asset: string; make?: string; kind?: string; kit?: boolean },
) {
  await page.goto('/items/new');
  await ready(page);
  await page.getByLabel('Which depot does it belong to?').selectOption({ label: DEPOT });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Add an item at E2E-A');
  await ready(page);
  await page.getByLabel('Kind').selectOption({ label: fields.kind ?? 'Ladder' });
  await page.getByLabel('Asset number').fill(fields.asset);
  if (fields.make) await page.getByLabel('Make').fill(fields.make);
  if (fields.kit) await page.getByLabel(/This is a kit/).check();
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fields.asset);
  return page.url().split('/items/')[1]!;
}

test('create an item, print its label and scan it signed in', async ({ page, request }, info) => {
  const asset = `E2E-${projectKey(info).slice(0, 2).toUpperCase()}-${runTag()}`;
  const id = await addItem(page, { asset, make: 'Examplo' });
  await expectAccessible(page);
  await expectNoSideways(page);

  // The label is a PDF, and the QR on the page carries a token, never the item's id.
  const pdf = await request.get(`/items/labels?ids=${id}&layout=a4-21`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const qr = await page.locator('.label-preview').innerHTML();
  expect(qr).not.toContain(id);

  // Scanning it while signed in goes to the item.
  await page.goto(`/i/${signItemCode(id, 1)}`);
  await expect(page).toHaveURL(`/items/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(asset);

  // The item is in the register and the CSV.
  await page.goto(`/items?q=${asset}`);
  await expect(page.getByRole('link', { name: asset, exact: true })).toBeVisible();
  const csv = await request.get(`/items/export?q=${asset}`);
  expect(await csv.text()).toContain(asset);
  await expectAccessible(page);
});

test('the item page leads on a phone, and replacing a label retires the old print', async ({
  page,
}, info) => {
  const asset = `E2E-P${projectKey(info).slice(0, 1).toUpperCase()}-${runTag()}`;
  const id = await addItem(page, { asset });
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  // The item leads: its name and status come before any panel, and well inside the first screen
  // (the evaluation notice and the top bar sit above it on a phone).
  const firstPanel = await page.locator('section.panel').first().boundingBox();
  expect(heading!.y).toBeLessThan(firstPanel!.y);
  expect(heading!.y).toBeLessThan(420);
  const oldCode = signItemCode(id, 1);
  await ready(page);
  await page.getByRole('button', { name: 'Replace the label' }).click();
  await expect(page.getByText(/Label replaced/)).toBeVisible();
  // The old print now shows nothing about the item; the new one opens it.
  const anonymous = await page
    .context()
    .browser()!
    .newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/i/${oldCode}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Label not recognised');
  await visitor.goto(`/i/${signItemCode(id, 2)}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(asset);
  await anonymous.close();
});

test('scanning with no login shows only the kind and asset number, and the same page for a forged code', async ({
  page,
  browser,
}, info) => {
  const asset = `E2E-S${projectKey(info).slice(0, 1).toUpperCase()}-${runTag()}`;
  const id = await addItem(page, { asset, make: 'Secretmake' });
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/i/${signItemCode(id, 1)}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(asset);
  const text = (await visitor.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(text).toContain('Ladder');
  expect(text).toContain('Report a fault: coming soon');
  // Nothing else about the item.
  for (const secret of ['Secretmake', 'E2E-A', 'Alderbank', 'Van', 'Store', 'Available', 'serial'])
    expect(text).not.toContain(secret);
  await expect(visitor.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expectAccessible(visitor);
  await expectNoSideways(visitor);

  // Forged, shortened and invented codes: one and the same page, with no details.
  const good = signItemCode(id, 1);
  const flipped = good.slice(0, 20) + (good[20] === 'A' ? 'B' : 'A') + good.slice(21);
  const pages = new Set<string>();
  for (const bad of [flipped, good.slice(1), 'x'.repeat(62), id, 'AAAA']) {
    await visitor.goto(`/i/${bad}`);
    pages.add((await visitor.locator('main').innerText()).replace(/\s+/g, ' '));
  }
  expect(pages.size).toBe(1);
  expect([...pages][0]).toContain('Label not recognised');
  // And the photo route is closed to anyone not signed in.
  const photo = await visitor.request.get('/item-photos/01a2b3c4-d5e6-7f80-9a1b-000000000000');
  expect(photo.status()).toBe(404);
  await anonymous.close();
});

test('import: a file with errors stores nothing and lists every problem; the fixed file stores everything', async ({
  page,
}, info) => {
  const tag = `IMP${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const cols = [...ITEM_IMPORT_COLUMNS];
  const row = (o: Record<string, string>) => cols.map((c) => o[c] ?? '').join(',');
  const file = (rows: string[]) => ({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([cols.join(','), ...rows].join('\n')),
  });

  await page.goto('/import');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import items');
  await expectAccessible(page);
  await ready(page);

  // First: one good row, one bad kind, one bad depot and cost.
  await page
    .getByLabel('CSV or Excel (.xlsx) file')
    .setInputFiles(
      file([
        row({ asset_number: `${tag}-1`, kind: 'Ladder', depot: 'E2E-A' }),
        row({ asset_number: `${tag}-2`, kind: 'Spaceship', depot: 'E2E-A' }),
        row({ asset_number: `${tag}-3`, kind: 'Ladder', depot: 'NOWHERE', cost: 'lots' }),
      ]),
    );
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('items.csv');
  await expect(page.locator('.badge', { hasText: 'Problems found' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /3 problems found/ })).toBeVisible();
  await expect(page.getByText('Nothing was stored.')).toBeVisible();
  const table = page.getByRole('region', { name: 'Problems', exact: true });
  await expect(table).toContainText('There is no kind called “Spaceship”');
  await expect(table).toContainText('There is no depot “NOWHERE”');
  await expect(table).toContainText('Enter an amount in pounds');
  await expect(table.getByRole('row').filter({ hasText: 'Spaceship' })).toContainText('3');
  await expectAccessible(page);
  await expectNoSideways(page);
  const problems = await page.request.get(page.url() + '/problems');
  expect(await problems.text()).toContain('line,column,problem');
  await page.goto(`/items?q=${tag}`);
  await expect(page.getByText('No items match')).toBeVisible();

  // Then the fixed file: both kits and a generated number, all stored.
  await page.goto('/import');
  await ready(page);
  await page
    .getByLabel('CSV or Excel (.xlsx) file')
    .setInputFiles(
      file([
        row({ asset_number: `${tag}-1`, kind: 'Ladder', depot: 'E2E-A', make: `Imp${tag}` }),
        row({ kind: 'Power tool', depot: 'E2E-A', make: `Imp${tag}`, location: 'A-VAN1' }),
      ]),
    );
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByRole('heading', { name: 'No problems found' })).toBeVisible();
  await page.getByRole('button', { name: 'Store 2 items' }).click();
  await expect(page.getByText('2 items stored.')).toBeVisible();
  await page.goto(`/items?q=Imp${tag}`);
  await expect(page.getByText('2 items')).toBeVisible();
  await expect(page.getByRole('link', { name: `${tag}-1`, exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('a kit set: a kit holds items, which show in it and can be taken out', async ({
  page,
}, info) => {
  const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const kit = `KIT-${tag}`;
  const part = `PART-${tag}`;
  const kitId = await addItem(page, { asset: kit, kind: 'Harness', kit: true });
  await addItem(page, { asset: part, kind: 'Harness' });
  await ready(page);
  await page.getByLabel('Kit at this depot').selectOption({ label: `${kit} · Harness` });
  await page.getByRole('button', { name: 'Put in this kit' }).click();
  await expect(page.getByRole('heading', { name: 'Part of a kit' })).toBeVisible();
  await page.goto(`/items/${kitId}`);
  await expect(page.getByRole('heading', { name: 'In this kit' })).toBeVisible();
  await expect(page.getByRole('link', { name: part })).toBeVisible();
  await expectAccessible(page);
  await ready(page);
  await page.getByRole('button', { name: `Take ${part} out` }).click();
  await expect(page.getByRole('link', { name: part })).toHaveCount(0);
  await page.goto(`/items?kits=kits&q=${kit}`);
  await expect(page.getByText(/kit of 0/)).toBeVisible();
});

test('photos: upload from the phone, see them on the item and in the list, and remove one', async ({
  page,
}, info) => {
  const asset = `E2E-F${projectKey(info).slice(0, 1).toUpperCase()}-${runTag()}`;
  await addItem(page, { asset });
  await ready(page);
  await page.getByLabel('Take or choose photos').setInputFiles([
    { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpegPhoto(120, 90) },
    { name: 'back.jpg', mimeType: 'image/jpeg', buffer: jpegPhoto(90, 120) },
  ]);
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByText('2 photos added.')).toBeVisible();
  await expect(page.locator('.photo-grid img')).toHaveCount(2);
  await expect(page.locator('.photo-grid img').first()).toHaveJSProperty('complete', true);
  expect(
    await page
      .locator('.photo-grid img')
      .first()
      .evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0);
  await expectAccessible(page);
  await expectNoSideways(page);

  // A file that isn't a photo is refused with a reason, and nothing is added.
  await page.getByLabel('Take or choose photos').setInputFiles({
    name: 'evil.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Only JPEG, PNG and WebP photos can be added' }),
  ).toBeVisible();
  await expect(page.locator('.photo-grid img')).toHaveCount(2);

  // It appears as the thumbnail in the list, and one can be removed.
  await page.goto(`/items?q=${asset}`);
  await expect(page.locator('img.item-thumb')).toHaveCount(1);
  await page.getByRole('link', { name: asset, exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.locator('.photo-grid img')).toHaveCount(1);
});

test('the register screens are accessible and fit the screen', async ({ page }) => {
  for (const path of ['/items', '/items/new', '/kinds', '/kinds/new', '/import']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSideways(page);
    await expectAccessible(page);
  }
  await page.goto('/kinds');
  await page.getByRole('link', { name: 'Lifting gear' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lifting gear');
  await expect(page.locator('strong', { hasText: 'Thorough examination' }).first()).toBeVisible();
  await expect(page.getByText(/not legal advice/).first()).toBeVisible();
  await expectAccessible(page);
  await expectNoSideways(page);
});
