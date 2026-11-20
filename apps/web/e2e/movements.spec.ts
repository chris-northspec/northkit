import { expect, test, type Page } from '@playwright/test';
import { E2E } from './global-setup';
import {
  expectAccessible,
  expectBigTargets,
  expectNoSideways,
  itemRow,
  makeItems,
  makeStore,
  projectKey,
  runTag,
  signIn,
  withDb,
} from './helpers';

// Sprint 3 journeys (acceptance A10, A16 to A18, A20), at both sizes, with axe: check out and
// in in a few taps, several items at once, who may do what, missing and found, transfers
// between depots, a stocktake by location, who has what and My kit. The offline journeys are
// in offline.spec.ts. Each test makes the kit it needs in the database, so none depends on
// another.

async function signInAs(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL('/');
}

/** Types an asset number into the picker and presses Enter. */
async function pick(page: Page, asset: string) {
  const box = page.getByLabel('Or type the asset number');
  await box.fill(asset);
  await box.press('Enter');
}

const noLogin = { storageState: { cookies: [], origins: [] } };

test.describe('as an operative', () => {
  test.use(noLogin);

  test('checks an item out to themselves and back in, in a few taps (A10)', async ({
    page,
  }, info) => {
    const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
    const [item] = await makeItems(1, tag);
    await signInAs(page, E2E.operative);

    await page.goto('/move/out');
    await expect(
      page.getByRole('heading', { level: 1, name: /Step 1: Scan the kit/ }),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoSideways(page);
    await expectBigTargets(page);
    await pick(page, item!.asset);
    await expect(page.getByRole('list', { name: 'Items to check out' })).toContainText(item!.asset);
    await page.getByRole('button', { name: /Next: where is it going/ }).click();

    // An operative can send kit to themselves or their own van only.
    await expect(page.getByRole('heading', { level: 1, name: /Where is it going/ })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveText([/^To me/, /^To my van/]);
    await expectBigTargets(page);
    await page.getByRole('radio', { name: 'To me' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByLabel(/Due back/)).not.toHaveValue('');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Checked out' })).toBeVisible();
    await expect(page.getByLabel('What was done')).toContainText(
      `${item!.asset} checked out to you`,
    );
    await expectAccessible(page);

    expect(await itemRow(item!.id)).toMatchObject({ status: 'out', holder: E2E.operative });

    // The item says who has it, and My kit lists it with its due-back date.
    await page.goto(`/items/${item!.id}`);
    await expect(page.getByText('Out since')).toBeVisible();
    await page.goto('/my-kit');
    await expect(page.getByRole('list').filter({ hasText: item!.asset })).toBeVisible();
    await expectAccessible(page);

    // Check it back in: to the depot's store, with a note on its condition.
    await page.goto(`/move/in?item=${item!.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: /Where is it going back to/ }),
    ).toBeVisible();
    await expect(page.getByLabel('Returned to')).toContainText('the depot’s store');
    await page.getByLabel('Condition note (optional)').fill('Chuck a little loose');
    await expectBigTargets(page);
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Checked in' })).toBeVisible();
    expect(await itemRow(item!.id)).toMatchObject({
      status: 'available',
      holder: null,
      location: 'A-STORE',
    });

    // The history says who, when and from where, and keeps the note.
    await page.goto(`/items/${item!.id}`);
    const history = page
      .getByRole('region', { name: 'Where it has been' })
      .or(page.locator('section[aria-labelledby="moves-heading"]'));
    await expect(history).toContainText('Checked in');
    await expect(history).toContainText('Checked out');
    await expect(history).toContainText('Chuck a little loose');
    await expect(history).toContainText('Operative A');
  });

  test('checks several items out to their own van together, and is told why one can’t go', async ({
    page,
  }, info) => {
    const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
    const [a, b, c, gone] = await makeItems(4, tag);
    await withDb((pool) =>
      pool.query(
        `INSERT INTO movements.movements (site_id, item_id, movement_type, note)
         SELECT site_id, id, 'missing', 'Not on the shelf' FROM register.items WHERE id = $1`,
        [gone!.id],
      ),
    );
    await signInAs(page, E2E.operative);
    await page.goto('/move/out');
    await expect(page.getByRole('heading', { level: 1, name: /Scan the kit/ })).toBeVisible();
    for (const i of [a!, b!, c!]) {
      await pick(page, i.asset);
      await expect(page.getByRole('list', { name: 'Items to check out' })).toContainText(i.asset);
    }
    // A missing item can't go out: the screen says so in words, with an alert.
    await pick(page, gone!.asset);
    await expect(
      page.getByRole('alert').filter({ hasText: `${gone!.asset}: It is reported missing` }),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Items to check out' })).not.toContainText(
      gone!.asset,
    );
    await page.getByRole('button', { name: /Next: where are they going/ }).click();
    await page.getByRole('radio', { name: /To my van/ }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check out 3 items' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Checked out' })).toBeVisible();
    for (const i of [a!, b!, c!])
      expect(await itemRow(i.id)).toMatchObject({
        status: 'out',
        holder: null,
        location: 'A-VAN1',
      });
    expect((await itemRow(gone!.id)).status).toBe('missing');
  });

  test('can’t check kit out to someone else, and a Supervisor can', async ({
    page,
    browser,
  }, info) => {
    const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
    const [item] = await makeItems(1, tag);
    await signInAs(page, E2E.operative);
    // The service refuses it too, whatever the screen offers: try the API directly.
    const second = await withDb(
      async (pool) =>
        (await pool.query('SELECT id FROM core.users WHERE email = $1', [E2E.operativeTwo]))
          .rows[0]!.id,
    );
    const denied = await page.request.post('/api/sync', {
      headers: { 'x-northkit-sync': '1', 'content-type': 'application/json' },
      data: {
        kind: 'check_out',
        itemId: item!.id,
        destination: { kind: 'person', userId: second },
      },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toContain('yourself and to your own van');
    expect((await itemRow(item!.id)).status).toBe('available');

    const context = await browser.newContext({
      ...noLogin,
      viewport: page.viewportSize() ?? undefined,
    });
    const sup = await context.newPage();
    await signInAs(sup, E2E.supervisor);
    await sup.goto(`/move/out?item=${item!.id}`);
    await expect(sup.getByRole('heading', { level: 1, name: /Scan the kit/ })).toBeVisible();
    await sup.getByRole('button', { name: /Next: where is it going/ }).click();
    // No van of their own, so four choices.
    await expect(sup.getByRole('radio')).toHaveCount(4);
    await sup.getByRole('radio', { name: 'To a person' }).click();
    await sup.getByLabel('Which person?').selectOption({ label: 'Operative A2' });
    await sup.getByRole('button', { name: 'Next', exact: true }).click();
    await sup.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(sup.getByRole('heading', { level: 1, name: 'Checked out' })).toBeVisible();
    expect(await itemRow(item!.id)).toMatchObject({ status: 'out', holder: E2E.operativeTwo });
    await context.close();
  });

  test('reports an item missing, and it needs action until it is found', async ({
    page,
    browser,
  }, info) => {
    const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
    const [item] = await makeItems(1, tag);
    await signInAs(page, E2E.operative);
    await page.goto(`/move/missing?item=${item!.id}`);
    await page.getByLabel('What happened? (optional)').fill('Not in the van after the Smith job');
    await expectBigTargets(page);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Report missing' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reported missing' })).toBeVisible();
    expect((await itemRow(item!.id)).status).toBe('missing');

    // A supervisor sees it on the needs-action panel, says who reported it, and records it found.
    const context = await browser.newContext({
      ...noLogin,
      viewport: page.viewportSize() ?? undefined,
    });
    const sup = await context.newPage();
    await signInAs(sup, E2E.supervisor);
    await expect(sup.getByRole('link', { name: new RegExp(`Find ${item!.asset}`) })).toContainText(
      'Operative A',
    );
    await sup.goto(`/items/${item!.id}`);
    await sup.getByLabel('Where it was found').selectOption({ label: 'Van 1 (A-VAN1)' });
    await sup.getByRole('button', { name: 'Record it as found' }).click();
    await expect(sup.locator('#where-heading')).not.toHaveText('Reported missing');
    expect(await itemRow(item!.id)).toMatchObject({ status: 'out', location: 'A-VAN1' });
    await context.close();
  });
});

test('who has what: by person, van, site and store, with a CSV and the overdue filter', async ({
  page,
  request,
}, info) => {
  const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const [mine, inVan, onSite] = await makeItems(3, tag);
  await withDb(async (pool) => {
    const actor = (await pool.query('SELECT id FROM core.users WHERE email = $1', [E2E.operative]))
      .rows[0]!.id;
    const ids = Object.fromEntries(
      (
        await pool.query(`SELECT code, id FROM core.locations WHERE code IN ('A-VAN1', 'A-JOB1')`)
      ).rows.map((r) => [r.code, r.id]),
    );
    const site = (await pool.query(`SELECT id FROM core.sites WHERE code = 'E2E-A'`)).rows[0]!.id;
    await pool.query(
      `INSERT INTO movements.movements (site_id, item_id, movement_type, to_user_id, due_back_on) VALUES ($1, $2, 'check_out', $3, current_date + 1)`,
      [site, mine!.id, actor],
    );
    await pool.query(
      `INSERT INTO movements.movements (site_id, item_id, movement_type, to_location_id) VALUES ($1, $2, 'check_out', $3)`,
      [site, inVan!.id, ids['A-VAN1']],
    );
    await pool.query(
      `INSERT INTO movements.movements (site_id, item_id, movement_type, to_location_id) VALUES ($1, $2, 'check_out', $3)`,
      [site, onSite!.id, ids['A-JOB1']],
    );
    // Make the first overdue: its due date passed yesterday (fixtures may switch the guard off).
    await pool.query('ALTER TABLE register.items DISABLE TRIGGER guard_item_whereabouts');
    await pool.query(
      `UPDATE register.items SET due_back_on = current_date - 1, overdue_at = now() - interval '1 hour' WHERE id = $1`,
      [mine!.id],
    );
    await pool.query('ALTER TABLE register.items ENABLE TRIGGER guard_item_whereabouts');
  });
  await page.goto('/who-has-what');
  await expect(page.getByRole('heading', { level: 1, name: 'Who has what' })).toBeVisible();
  const person = page.locator('section.group-card').filter({ hasText: 'Operative A' }).first();
  await expect(person).toContainText(mine!.asset);
  await expect(person).toContainText('Overdue');
  await expectAccessible(page);
  await expectNoSideways(page);
  for (const [view, code, asset] of [
    ['van', 'Van 1', inVan!.asset],
    ['site', 'Smith job', onSite!.asset],
    ['store', 'Main store', undefined],
  ] as const) {
    await page.goto(`/who-has-what?view=${view}`);
    const group = page.locator('section.group-card').filter({ hasText: code }).first();
    await expect(group).toBeVisible();
    if (asset) await expect(group).toContainText(asset);
    await expectAccessible(page);
  }
  // Only what is overdue: the Overview's card opens this list.
  await page.goto('/who-has-what?overdue=1');
  await expect(page.locator('main')).toContainText(mine!.asset);
  await expect(page.locator('main')).not.toContainText(inVan!.asset);
  const csv = await request.get('/who-has-what/export?view=person');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain(mine!.asset);
});

test('a transfer between depots: sent, in transit, received at the other depot (A18)', async ({
  page,
}, info) => {
  const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const [item] = await makeItems(1, tag);
  await page.goto(`/items/${item!.id}`);
  const send = page.locator('section[aria-labelledby="send-heading"]');
  await send.getByLabel('Depot').selectOption({ label: 'E2E-B · Birchmoor depot' });
  await send.getByLabel('Who or what is carrying it').fill('Depot van 3');
  await send
    .getByLabel('Expected on')
    .fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
  await send.getByRole('button', { name: 'Send it' }).click();
  await expect(page.getByText('On its way to another depot')).toBeVisible();
  expect((await itemRow(item!.id)).status).toBe('in_transit');

  // It can't be checked out in transit, and the Overview counts it.
  await page.goto(`/items/${item!.id}`);
  await expect(page.locator('main').getByRole('link', { name: 'Check out' })).toHaveCount(0);
  await expect(page.getByText('On its way to another depot')).toBeVisible();

  await page.goto('/transfers');
  const card = page.locator(`article[aria-label="Transfer of ${item!.asset}"]`).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('E2E-A');
  await expect(card).toContainText('Depot van 3');
  await expectAccessible(page);
  await expectNoSideways(page);
  // Received at depot B, by whoever works there (the administrator works at both).
  await card.getByLabel('Put it in').selectOption({ label: 'Birchmoor store (B-STORE)' });
  await card.getByRole('button', { name: 'Receive it here' }).click();
  await expect(card).toHaveCount(0);
  expect(await itemRow(item!.id)).toMatchObject({
    status: 'available',
    location: 'B-STORE',
    site: 'E2E-B',
  });
  await page.goto('/transfers');
  await expect(page.locator(`article[aria-label="Transfer of ${item!.asset}"]`)).toHaveCount(0);
});

test('a stocktake of a location: found, not found and not expected, and only the choices made are applied (A17)', async ({
  page,
  browser,
}, info) => {
  const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const store = await makeStore(tag, 3);
  const [here, gone, spare] = store.items;
  const [stray] = await makeItems(1, `${tag}S`);
  const context = await browser.newContext({
    ...noLogin,
    viewport: page.viewportSize() ?? undefined,
  });
  const sup = await context.newPage();
  await signInAs(sup, E2E.supervisor);
  await sup.goto('/stocktake');
  await expect(sup.getByRole('heading', { level: 1, name: 'Stocktake' })).toBeVisible();
  await expectAccessible(sup);
  await sup
    .locator('tr', { hasText: store.name })
    .getByRole('button', { name: `Count ${store.name}` })
    .click();
  await expect(
    sup.getByRole('heading', { level: 1, name: new RegExp(`Count ${store.name}`) }),
  ).toBeVisible();
  await expectBigTargets(sup);
  for (const i of [here!, spare!, stray!]) {
    await pick(sup, i.asset);
    await expect(sup.getByRole('list', { name: 'Counted here' })).toContainText(i.asset);
  }
  await expect(sup.getByTestId('scanned-count')).toHaveText('3');
  await sup.getByRole('button', { name: /Finish scanning/ }).click();

  // The result: expected and found, expected but not found, found but not expected.
  await expect(sup.getByRole('heading', { level: 1, name: store.name })).toBeVisible();
  await expect(sup.locator('section[aria-labelledby="found-h"]')).toContainText(here!.asset);
  await expect(sup.locator('section[aria-labelledby="nf-h"]')).toContainText(gone!.asset);
  await expect(sup.locator('section[aria-labelledby="un-h"]')).toContainText(stray!.asset);
  await expectAccessible(sup);
  await expectNoSideways(sup);
  // Closing without choosing says what is left.
  await sup.getByRole('button', { name: /Close the stocktake/ }).click();
  await expect(sup.getByRole('alert').filter({ hasText: 'Choose what to do about' })).toBeVisible();
  // Mark the missing one missing, move the stray here.
  await sup.getByRole('radio', { name: 'Missing' }).check();
  await sup.getByRole('radio', { name: 'Move here' }).check();
  await sup.getByRole('button', { name: /Close the stocktake/ }).click();
  await expect(sup.getByText('Closed', { exact: true })).toBeVisible();
  expect((await itemRow(gone!.id)).status).toBe('missing');
  expect(await itemRow(stray!.id)).toMatchObject({ location: `CNT-${tag}`, status: 'available' });
  expect(await itemRow(here!.id)).toMatchObject({ location: `CNT-${tag}` });
  // The location remembers when it was counted.
  await sup.goto('/stocktake');
  await expect(sup.locator('tr', { hasText: store.name })).not.toContainText('Never');
  await context.close();
});

test('the Overview shows real movement figures and a sparkline from the history', async ({
  page,
}, info) => {
  const tag = `${projectKey(info).slice(0, 2).toUpperCase()}${runTag()}`;
  const [item] = await makeItems(1, tag);
  await withDb(async (pool) => {
    const site = (await pool.query(`SELECT id FROM core.sites WHERE code = 'E2E-A'`)).rows[0]!.id;
    const user = (await pool.query('SELECT id FROM core.users WHERE email = $1', [E2E.operative]))
      .rows[0]!.id;
    await pool.query(
      `INSERT INTO movements.movements (site_id, item_id, movement_type, to_user_id) VALUES ($1, $2, 'check_out', $3)`,
      [site, item!.id, user],
    );
  });
  await page.goto('/');
  const out = page.locator('.stats').getByRole('link', { name: /^Items out/ });
  await expect(out).toBeVisible();
  await expect(out.locator('svg.sparkline')).toHaveAttribute('role', 'img');
  await expect(out.locator('svg.sparkline')).toHaveAttribute(
    'aria-label',
    /Items out at the end of each of the last 14 days/,
  );
  await expect(out.locator('.figure')).not.toHaveText('0');
  await expectAccessible(page);
});
