// The house-style check (visual standard section 6, S2-8): NorthKit's sign-in, item list,
// item page, item form and empty register, at 1280 wide and on a 390 x 844 phone, in light
// and dark, saved to docs/screens/house-style-check/ beside NorthSlot's matching screens so
// the pairs can be compared: they should read as the same family. Everything is from made-up
// demo data only (`pnpm db:seed-demo`). Usage, with NorthKit's production build served on the
// demo database (see docs/screens/README.md):
//   SCREENS_URL=http://localhost:3205 SCREENS_PASSWORD=... \
//   [NORTHSLOT_URL=http://127.0.0.1:8000 NORTHSLOT_EMAIL=... NORTHSLOT_PASSWORD=...] \
//   node scripts/house-style-check.mjs
// NorthSlot's sign-in page is public and is always taken. Its signed-in screens (day board,
// list, detail, form) are taken only when Chris supplies his own NorthSlot login in the
// NORTHSLOT_ variables (read from the environment only, never printed, and nothing is
// added to NorthSlot's database). The empty-register screen needs an empty database: pass
// SCREENS_EMPTY_URL (a second server on an empty database, signed in with SCREENS_EMPTY_EMAIL
// and SCREENS_PASSWORD) or it is skipped. The evaluation banner is removed, as a licensed
// install would show it (D32 in NorthKeep).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const kit = {
  url: process.env.SCREENS_URL ?? 'http://localhost:3205',
  email: process.env.SCREENS_EMAIL ?? 'demo.kitmanager@northkit.test',
  password: process.env.SCREENS_PASSWORD,
};
const empty = process.env.SCREENS_EMPTY_URL
  ? {
      url: process.env.SCREENS_EMPTY_URL,
      email: process.env.SCREENS_EMPTY_EMAIL ?? kit.email,
      password: kit.password,
    }
  : null;
const slot = {
  url: process.env.NORTHSLOT_URL ?? 'http://127.0.0.1:8000',
  email: process.env.NORTHSLOT_EMAIL,
  password: process.env.NORTHSLOT_PASSWORD,
};
if (!kit.password) throw new Error('Set SCREENS_PASSWORD to the NorthKit demo password.');
const out = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'screens',
  'house-style-check',
);
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: '1280', viewport: { width: 1280, height: 800 }, isMobile: false },
  { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true },
];

async function signIn(page, { url, email, password }, home = '/') {
  await page.goto(`${url}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^(Sign in|Log in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${url}${home}`);
  await page.waitForLoadState('networkidle');
}

const shot = async (page, name) => {
  await page.locator('.licence-banner').evaluateAll((b) => b.forEach((x) => x.remove()));
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  process.stdout.write(`wrote ${name}.png\n`);
};

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const scheme of ['light', 'dark']) {
      const options = {
        viewport: size.viewport,
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
        deviceScaleFactor: 2,
        colorScheme: scheme,
      };
      const prefix = `${size.name}-${scheme}`;

      // Signed out: the sign-in screens, side by side.
      const anon = await browser.newContext(options);
      const a = await anon.newPage();
      await a.goto(`${kit.url}/login`);
      await a.waitForLoadState('networkidle');
      await shot(a, `${prefix}-northkit-sign-in`);
      try {
        await a.goto(`${slot.url}/login`);
        await a.waitForLoadState('networkidle');
        await shot(a, `${prefix}-northslot-sign-in`);
      } catch {
        process.stdout.write(`NorthSlot not reachable at ${slot.url}: its sign-in was skipped\n`);
      }
      await anon.close();

      // Signed in: NorthKit's register screens.
      const context = await browser.newContext(options);
      const page = await context.newPage();
      await signIn(page, kit, '/items');
      await shot(page, `${prefix}-northkit-item-list`);
      await page.locator('table tbody tr a').first().click();
      await page.waitForURL(/\/items\/[0-9a-f-]{36}$/);
      await page.waitForLoadState('networkidle');
      await shot(page, `${prefix}-northkit-item-page`);
      await page.goto(`${kit.url}/items/new`);
      await page
        .getByLabel('Which depot does it belong to?')
        .selectOption({ index: 1 })
        .catch(() => {});
      await page
        .getByRole('button', { name: 'Continue' })
        .click()
        .catch(() => {});
      await page.waitForLoadState('networkidle');
      await shot(page, `${prefix}-northkit-item-form`);
      await page.goto(`${kit.url}/`);
      await page.waitForLoadState('networkidle');
      await shot(page, `${prefix}-northkit-overview`);
      await context.close();

      if (empty) {
        const e = await browser.newContext(options);
        const p = await e.newPage();
        await signIn(p, empty, '/items');
        await shot(p, `${prefix}-northkit-empty-register`);
        await e.close();
      }

      if (slot.email && slot.password) {
        const other = await browser.newContext(options);
        const p2 = await other.newPage();
        await signIn(p2, slot, '/');
        await shot(p2, `${prefix}-northslot-day-board`);
        await other.close();
      }
    }
  }
} finally {
  await browser.close();
}
