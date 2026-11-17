// The house-style check (S7-11, Chris, 15 Nov 2026): NorthKit's overview beside NorthSlot's
// day board, at 1280 wide and on a 390 x 844 phone, saved to docs/screens/house-style-check/
// so the pair can be compared: they should read as the same family. Both from made-up demo
// data only. Usage, with NorthKit's build served on the demo database (as screens.mjs):
//   SCREENS_URL=http://localhost:3205 SCREENS_PASSWORD=... \
//   NORTHSLOT_URL=http://127.0.0.1:8000 NORTHSLOT_EMAIL=... NORTHSLOT_PASSWORD=... \
//   node scripts/house-style-check.mjs
// Without the NORTHSLOT_ variables only NorthKit's half is taken. The evaluation banner
// is removed as in screens.mjs (D32).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const keep = {
  url: process.env.SCREENS_URL ?? 'http://localhost:3205',
  email: process.env.SCREENS_EMAIL ?? 'demo.admin@northkit.test',
  password: process.env.SCREENS_PASSWORD,
};
const slot = {
  url: process.env.NORTHSLOT_URL ?? 'http://127.0.0.1:8000',
  email: process.env.NORTHSLOT_EMAIL,
  password: process.env.NORTHSLOT_PASSWORD,
};
if (!keep.password) throw new Error('Set SCREENS_PASSWORD to the NorthKit demo password.');
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

async function signIn(page, { url, email, password }, home) {
  await page.goto(`${url}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^(Sign in|Log in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${url}${home}`);
  await page.waitForLoadState('networkidle');
}

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const options = {
      viewport: size.viewport,
      isMobile: size.isMobile,
      hasTouch: size.isMobile,
      deviceScaleFactor: 2,
      colorScheme: 'light',
    };
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await signIn(page, keep, '/');
    await page.locator('.licence-banner').evaluateAll((b) => b.forEach((x) => x.remove()));
    await page.screenshot({ path: path.join(out, `${size.name}-northkit-overview.png`) });
    process.stdout.write(`wrote ${size.name}-northkit-overview.png\n`);
    await context.close();

    if (slot.email && slot.password) {
      const other = await browser.newContext(options);
      const p2 = await other.newPage();
      await signIn(p2, slot, '/');
      await p2.screenshot({ path: path.join(out, `${size.name}-northslot-day-board.png`) });
      process.stdout.write(`wrote ${size.name}-northslot-day-board.png\n`);
      await other.close();
    }
  }
} finally {
  await browser.close();
}
