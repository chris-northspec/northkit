import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E } from './global-setup';
import { itemRow, makeItems, makeStore, runTag, signIn, withDb, type MadeItem } from './helpers';

// Offline on a phone (S3-6, ADR 0004, acceptance A16): check-out, check-in, bulk check-out,
// report missing and stocktake scans work with no signal, nothing is lost when the app
// closes, and everything is sent when the phone is back online. The server is the record of
// truth: a change that no longer fits is refused, kept and shown, never applied silently.
// Runs at phone size only: this is a phone's job. A persistent browser profile stands in for
// the phone, so closing it and opening it again keeps what the phone kept (IndexedDB and the
// service worker's pages), as a restart would.

test.use({ storageState: { cookies: [], origins: [] } });

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  baseURL: undefined as string | undefined,
};

async function openPhone(
  launch: (dir: string, options: Record<string, unknown>) => Promise<BrowserContext>,
  dir: string,
  baseURL: string,
): Promise<BrowserContext> {
  return launch(dir, { ...PHONE, baseURL });
}

/** Opens a screen online and waits until the service worker has kept it for offline use. */
async function keep(page: Page, url: string, heading: RegExp | string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Works offline on this phone')).toBeVisible({ timeout: 30_000 });
}

async function pick(page: Page, asset: string) {
  const box = page.getByLabel('Or type the asset number');
  await box.fill(asset);
  await box.press('Enter');
}

/** Waits for the phone's banner to say nothing is left to send. */
async function waitSynced(page: Page) {
  await expect(page.getByTestId('waiting-count')).toHaveCount(0, { timeout: 60_000 });
}

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'phone-390x844', 'Offline use is a phone job.');
});

test('five movements and a stocktake offline, kept through a restart, then synced (A16, A17)', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const tag = `OF${runTag()}`;
  const [a, b, c, d, e, f] = await makeItems(6, tag);
  // F is already out to this operative when the phone makes its copy, so it can be checked in offline.
  await withDb(async (pool) => {
    const site = (await pool.query(`SELECT id FROM core.sites WHERE code = 'E2E-A'`)).rows[0]!.id;
    const me = (await pool.query('SELECT id FROM core.users WHERE email = $1', [E2E.operative]))
      .rows[0]!.id;
    await pool.query(
      `INSERT INTO movements.movements (site_id, item_id, movement_type, to_user_id) VALUES ($1, $2, 'check_out', $3)`,
      [site, f!.id, me],
    );
  });
  const store = await makeStore(`${tag}C`, 3);
  const [here, alsoHere] = store.items;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'northkit-phone-'));
  const launch = (d: string, o: Record<string, unknown>) =>
    playwright.chromium.launchPersistentContext(d, o);
  try {
    // 1. Online: sign in and open the screens once, so the phone keeps them and the kit.
    let context = await openPhone(launch, dir, baseURL!);
    let page = context.pages()[0] ?? (await context.newPage());
    await signIn(page, E2E.operative);
    await expect(page).toHaveURL('/');
    await keep(page, '/move/out', /Scan the kit/);
    await keep(page, '/move/in', /Scan the item/);
    await keep(page, '/move/missing', /Which item is missing/);
    await keep(page, '/stocktake', 'Stocktake');
    // The counting screen with no count named says so, and is still kept for every count.
    await page.goto('/stocktake/count');
    await expect(page.getByText('Works offline on this phone')).toBeVisible({ timeout: 30_000 });
    await keep(page, '/sync', 'Changes not sent yet');

    // 2. Offline: five movements and a stocktake.
    await context.setOffline(true);
    // (1) check out one to themselves
    await page.goto('/move/out');
    await expect(page.getByRole('heading', { level: 1, name: /Scan the kit/ })).toBeVisible();
    await expect(page.getByText('You’re offline')).toBeVisible();
    await pick(page, a!.asset);
    await page.getByRole('button', { name: /Next: where is it going/ }).click();
    await page.getByRole('radio', { name: 'To me' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();
    // (2) a bulk check-out of two to their van
    await page.goto('/move/out');
    for (const i of [b!, c!]) {
      await pick(page, i.asset);
      await expect(page.getByRole('list', { name: 'Items to check out' })).toContainText(i.asset);
    }
    await page.getByRole('button', { name: /Next: where are they going/ }).click();
    await page.getByRole('radio', { name: /To my van/ }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check out 2 items' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();
    // (3) report one missing
    await page.goto('/move/missing');
    await pick(page, d!.asset);
    await page.getByLabel('What happened? (optional)').fill('Left on site');
    await page.getByRole('button', { name: 'Report missing' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();
    // (4) check an item in that the phone's copy knows is out
    await page.goto('/move/in');
    await pick(page, f!.asset);
    await page.getByLabel('Condition note (optional)').fill('Cable worn');
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();
    // (5) report another missing
    await page.goto('/move/missing');
    await pick(page, e!.asset);
    await page.getByRole('button', { name: 'Report missing' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();

    // (+) a stocktake of the new store, offline: start it, scan two items
    await page.goto('/stocktake');
    await page
      .locator('tr', { hasText: store.name })
      .getByRole('button', { name: `Count ${store.name}` })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(`Count ${store.name}`) }),
    ).toBeVisible({ timeout: 30_000 });
    for (const i of [here!, alsoHere!]) {
      await pick(page, i.asset);
      await expect(page.getByRole('list', { name: 'Counted here' })).toContainText(i.asset);
    }
    await expect(page.getByTestId('scanned-count')).toHaveText('2');
    // Everything is waiting, and nothing has reached the server.
    await expect(page.getByTestId('waiting-count')).toBeVisible();
    expect((await itemRow(a!.id)).status).toBe('available');

    // 3. The phone restarts: close it and open it again, still with no signal.
    await context.close();
    context = await openPhone(launch, dir, baseURL!);
    page = context.pages()[0] ?? (await context.newPage());
    await context.setOffline(true);
    await page.goto('/sync').catch(() => undefined);
    await expect(page.getByRole('heading', { level: 1, name: 'Changes not sent yet' })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole('list', { name: 'On this phone' }).getByRole('listitem'),
    ).toHaveCount(9, { timeout: 30_000 });
    expect((await itemRow(a!.id)).status).toBe('available');

    // 4. Back online: everything is sent, in order, and applied.
    await context.setOffline(false);
    await page.reload();
    await waitSynced(page);
    await expect(page.getByText('Everything has been sent.')).toBeVisible({ timeout: 60_000 });
    expect(await itemRow(a!.id)).toMatchObject({ status: 'out', holder: E2E.operative });
    for (const i of [b!, c!])
      expect(await itemRow(i.id)).toMatchObject({ status: 'out', location: 'A-VAN1' });
    expect((await itemRow(d!.id)).status).toBe('missing');
    expect((await itemRow(e!.id)).status).toBe('missing');
    expect(await itemRow(f!.id)).toMatchObject({ status: 'available', location: 'A-STORE' });
    const lines = await withDb(async (pool) =>
      (
        await pool.query(
          `SELECT i.asset_number FROM movements.stocktake_lines l JOIN register.items i ON i.id = l.item_id
          JOIN movements.stocktakes s ON s.id = l.stocktake_id JOIN core.locations loc ON loc.id = s.location_id
         WHERE loc.name = $1 ORDER BY 1`,
          [store.name],
        )
      ).rows.map((r) => r.asset_number as string),
    );
    expect(lines).toEqual([here!.asset, alsoHere!.asset].sort());
    await context.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // Chrome may hold a file for a moment on Windows; the folder is in the temp directory.
    }
  }
});

test('a clash: kit someone else checked out while the phone was offline is refused, kept and shown (A16)', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const tag = `CL${runTag()}`;
  const [x, y] = (await makeItems(2, tag)) as [MadeItem, MadeItem];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'northkit-phone-'));
  try {
    const context = await playwright.chromium.launchPersistentContext(dir, {
      ...PHONE,
      baseURL: baseURL!,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await signIn(page, E2E.operative);
    await expect(page).toHaveURL('/');
    await keep(page, '/move/out', /Scan the kit/);
    await keep(page, '/sync', 'Changes not sent yet');
    await context.setOffline(true);
    await page.goto('/move/out');
    await expect(page.getByRole('heading', { level: 1, name: /Scan the kit/ })).toBeVisible();
    for (const i of [x, y]) await pick(page, i.asset);
    await page.getByRole('button', { name: /Next: where are they going/ }).click();
    await page.getByRole('radio', { name: 'To me' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Check out 2 items' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saved on this phone' }),
    ).toBeVisible();

    // Meanwhile, a supervisor checks X out to someone else.
    await withDb(async (pool) => {
      const site = (await pool.query(`SELECT id FROM core.sites WHERE code = 'E2E-A'`)).rows[0]!.id;
      const other = (
        await pool.query('SELECT id FROM core.users WHERE email = $1', [E2E.operativeTwo])
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO movements.movements (site_id, item_id, movement_type, to_user_id) VALUES ($1, $2, 'check_out', $3)`,
        [site, x.id, other],
      );
    });

    // Back online: Y goes through, X is refused with the reason and kept on the phone.
    await context.setOffline(false);
    await page.goto('/sync');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Changes not sent yet' }),
    ).toBeVisible();
    const refused = page.getByRole('listitem').filter({ hasText: `Check out ${x.asset}` });
    await expect(refused).toContainText('Not applied', { timeout: 60_000 });
    await expect(refused.getByRole('alert')).toContainText(`${x.asset} is already out`);
    await expect(
      page.getByRole('listitem').filter({ hasText: `Check out ${y.asset}` }),
    ).toHaveCount(0);
    // Nothing was applied silently: X is still with the other person, Y is with this one.
    expect(await itemRow(x.id)).toMatchObject({ status: 'out', holder: E2E.operativeTwo });
    expect(await itemRow(y.id)).toMatchObject({ status: 'out', holder: E2E.operative });
    // The banner says so on every page, and the change stays until the person chooses.
    await page.goto('/my-kit');
    await expect(page.getByRole('status').filter({ hasText: /couldn’t be applied/ })).toBeVisible();
    await page.goto('/sync');
    await page
      .getByRole('listitem')
      .filter({ hasText: `Check out ${x.asset}` })
      .getByRole('button', { name: 'Discard' })
      .click();
    await page.getByRole('button', { name: 'Yes, discard it' }).click();
    await expect(page.getByText('Everything has been sent.')).toBeVisible();
    await context.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // Chrome may hold a file for a moment on Windows; the folder is in the temp directory.
    }
  }
});
