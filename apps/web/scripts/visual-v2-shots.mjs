// Visual review shots for House style v2 (standard 13, section 7; S3-1): every screen the
// uplift touched, in light, dark and on a 390 x 844 phone, saved under
// docs/screens/visual-v2/<SHOTS_SET>/ (`before` from a build of main, `after` from this
// branch), and the Sprint 3 screens for docs/screens/ (S3-7). Everything is made-up demo
// data (`pnpm db:seed-demo`). Usage, with a production build served on the demo database:
//   SCREENS_URL=http://localhost:3205 SCREENS_PASSWORD=... SHOTS_SET=after \
//   node apps/web/scripts/visual-v2-shots.mjs
// A screen the build doesn't have (the before set has no movement screens) is skipped and
// said so. The evaluation banner is removed, as a licensed install would show it. The script
// waits for React to have hydrated each page (data-hydrated), never for the network.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const url = process.env.SCREENS_URL ?? 'http://localhost:3205';
const email = process.env.SCREENS_EMAIL ?? 'demo.kitmanager@northkit.test';
const operative = process.env.SCREENS_OPERATIVE ?? 'demo.operative1@northkit.test';
const password = process.env.SCREENS_PASSWORD;
const set = process.env.SHOTS_SET ?? 'after';
if (!password) throw new Error('Set SCREENS_PASSWORD to the NorthKit demo password.');
const root = path.join(import.meta.dirname, '..', '..', '..', 'docs', 'screens');
const out = path.join(root, 'visual-v2', set);
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: '1280', viewport: { width: 1280, height: 800 }, isMobile: false },
  { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true },
];

/** Waits for React to have hydrated the page, or (an older build) for the load event. */
async function settled(page) {
  await page.waitForLoadState('load');
  await page
    .waitForFunction("document.documentElement.dataset.hydrated === 'true'", null, {
      timeout: 8_000,
    })
    .catch(() => {});
  // Fonts and the first paint of client components.
  await page.waitForTimeout(400);
}

async function signIn(page, as) {
  await page.goto(`${url}/login`);
  await settled(page);
  await page.getByLabel('Email').fill(as);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Opens a path; false (and a note) if this build has no such page. */
async function open(page, pathname) {
  const response = await page.goto(`${url}${pathname}`);
  await settled(page);
  const missing =
    (response && response.status() === 404) ||
    (await page.getByRole('heading', { level: 1, name: 'Page not found' }).count()) > 0;
  if (missing) process.stdout.write(`skipped ${pathname}: not in this build\n`);
  return !missing;
}

const shot = async (page, name, dir = out) => {
  await page.locator('.licence-banner').evaluateAll((b) => b.forEach((x) => x.remove()));
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
  process.stdout.write(`wrote ${path.relative(root, path.join(dir, `${name}.png`))}\n`);
};

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const scheme of ['light', 'dark']) {
      // The phone is checked in light only for the uplift (the standard's "light, dark and
      // phone"); dark at 1280 covers dark mode.
      if (size.isMobile && scheme === 'dark') continue;
      const prefix = size.isMobile ? 'phone' : scheme;
      const options = {
        viewport: size.viewport,
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
        deviceScaleFactor: 2,
        colorScheme: scheme,
      };

      // Signed out: sign-in and the no-login scan page.
      const anon = await browser.newContext(options);
      const a = await anon.newPage();
      await a.goto(`${url}/login`);
      await settled(a);
      await shot(a, `${prefix}-sign-in`);
      await a.goto(`${url}/i/not-a-real-label`);
      await settled(a);
      await shot(a, `${prefix}-scan-page`);
      await anon.close();

      // Signed in as the Kit Manager: the shell and every screen the uplift touched.
      const context = await browser.newContext(options);
      const page = await context.newPage();
      await signIn(page, email);
      for (const [pathname, name] of [
        ['/', 'overview'],
        ['/items', 'item-list'],
        ['/kinds', 'kinds'],
        ['/import', 'import'],
        ['/settings', 'settings'],
        ['/who-has-what', 'who-has-what'],
        ['/transfers', 'transfers'],
        ['/stocktake', 'stocktake'],
      ]) {
        if (await open(page, pathname)) await shot(page, `${prefix}-${name}`);
      }
      // An item that is out, so the hero card has something to say.
      if (await open(page, '/items?status=out')) {
        const first = page.locator('table tbody tr a').first();
        if ((await first.count()) > 0) {
          await first.click();
          await page.waitForURL(/\/items\/[0-9a-f-]{36}$/);
          await settled(page);
          await shot(page, `${prefix}-item-page`);
        }
      }
      // The stocktake result: the newest closed count.
      if (await open(page, '/stocktake')) {
        const closed = page.locator('section[aria-labelledby="closed-h"] a').first();
        if ((await closed.count()) > 0) {
          await closed.click();
          await page.waitForURL(/\/stocktake\/[0-9a-f-]{36}$/);
          await settled(page);
          await shot(page, `${prefix}-stocktake-result`);
        }
      }
      await context.close();

      // Signed in as an operative: My kit and the check-out flow, as a phone would show them.
      const op = await browser.newContext(options);
      const p = await op.newPage();
      await signIn(p, operative);
      if (await open(p, '/my-kit')) await shot(p, `${prefix}-my-kit`);
      if (await open(p, '/move/out')) {
        await p
          .getByRole('heading', { level: 1, name: /Scan the kit/ })
          .waitFor({ timeout: 15_000 })
          .catch(() => {});
        await shot(p, `${prefix}-check-out-scan`);
        const box = p.getByLabel('Or type the asset number');
        if ((await box.count()) > 0) {
          await box.fill('ASH-PT-0');
          await p.waitForTimeout(300);
          const result = p.locator('.scan-results button').first();
          if ((await result.count()) > 0) {
            await result.click();
            await p.getByRole('button', { name: /Next: where/ }).click();
            await settled(p);
            await shot(p, `${prefix}-check-out-destination`);
          }
        }
      }
      await op.close();
    }
  }
} finally {
  await browser.close();
}
