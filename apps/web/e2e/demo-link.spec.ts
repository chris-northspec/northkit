import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import path from 'node:path';
import { expect, test, type PlaywrightWorkerArgs } from '@playwright/test';
import { createPool } from '@northkit/db';
import { DEMO_HOST, DEMO_ORIGIN, E2E_DB_NAME } from '../playwright.config';
import { E2E } from './global-setup';
import { expectAccessible, expectNoSideways, signIn } from './helpers';

// The demo link (docs/demo-link.md): the browser reaches the app by the demo name, as
// through the Cloudflare Tunnel, which connects from this machine and adds
// X-Forwarded-Proto and Cf-Connecting-Ip. Signing in works and the session holds; the
// visitor's address is the one the tunnel names; the demo strip shows only there. The
// demo link works under the development server only (playwright.config.ts starts one);
// the production build refuses to start with it set.

/**
 * A browser that reaches the app by the demo name: the name is mapped to the address the
 * server listens on (::1 or 127.0.0.1), an address not a name, so the browser still sends
 * the demo name as the Host.
 */
async function demoBrowser(playwright: PlaywrightWorkerArgs['playwright']) {
  const { address, family } = await lookup('localhost');
  return playwright.chromium.launch({
    args: [`--host-resolver-rules=MAP ${DEMO_HOST} ${family === 6 ? `[${address}]` : address}`],
  });
}

test('signs in through the demo address and keeps the session', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop', 'One browser is enough for the address.');
  // The development server compiles each page on its first visit.
  test.setTimeout(180_000);
  const port = new URL(DEMO_ORIGIN).port;
  const browser = await demoBrowser(playwright);
  try {
    const context = await browser.newContext({
      baseURL: DEMO_ORIGIN,
      extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'Cf-Connecting-Ip': '203.0.113.77' },
    });
    const page = await context.newPage();
    const before = new Date();
    await signIn(page, E2E.operative);
    await expect(page).toHaveURL(`http://${DEMO_HOST}:${port}/`);
    await expect(page.getByRole('note')).toHaveText('Demo, fictional data');
    // The session holds across pages and a reload.
    await page.goto('/sites');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/jobs$/);
    // The sign-in was recorded from the visitor's address, not the tunnel's.
    const pool = createPool('admin', { database: E2E_DB_NAME, max: 1 });
    try {
      const { rows } = await pool.query<{ ip: string }>(
        `SELECT host(e.ip_address) AS ip FROM audit.audit_events e JOIN core.users u ON u.id = e.created_by
          WHERE e.action = 'auth.sign_in' AND u.email = $1 AND e.created_at >= $2
          ORDER BY e.created_at DESC LIMIT 1`,
        [E2E.operative, before],
      );
      expect(rows[0]?.ip).toBe('203.0.113.77');
    } finally {
      await pool.end();
    }
    await context.close();
  } finally {
    await browser.close();
  }
});

// The strip in the shell (S1-9): at the top of the page column, directly above the
// slim top bar; beside the Ink sidebar at 1280, full width on a phone. Nothing scrolls
// sideways, the top bar stays one row, and axe passes at both sizes.
test('the demo strip sits above the top bar at both sizes', async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const { viewport, isMobile, hasTouch } = info.project.use;
  const browser = await demoBrowser(playwright);
  try {
    const context = await browser.newContext({
      baseURL: DEMO_ORIGIN,
      viewport,
      isMobile,
      hasTouch,
      extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'Cf-Connecting-Ip': '203.0.113.78' },
    });
    const page = await context.newPage();
    await signIn(page, E2E.operative);
    const strip = page.getByRole('note');
    await expect(strip).toHaveText('Demo, fictional data');
    await page.waitForLoadState('networkidle');
    const box = (await strip.boundingBox())!;
    const bar = (await page.getByRole('banner').boundingBox())!;
    expect(Math.round(box.y)).toBe(0);
    expect(Math.abs(box.y + box.height - bar.y)).toBeLessThanOrEqual(1);
    expect(Math.round(box.x)).toBe(Math.round(bar.x));
    expect(Math.round(box.x + box.width)).toBe(viewport!.width);
    expect(bar.height).toBeLessThanOrEqual(64);
    if (isMobile) {
      expect(Math.round(box.x)).toBe(0);
    } else {
      // Beside the Ink sidebar, which still runs from the top of the screen.
      const side = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
      expect(Math.round(side.y)).toBe(0);
      expect(Math.round(box.x)).toBe(Math.round(side.x + side.width));
    }
    await page.screenshot({ path: info.outputPath('demo-strip.png') });
    await expectNoSideways(page);
    await expectAccessible(page);
    await context.close();
  } finally {
    await browser.close();
  }
});

test('the usual address shows no demo strip and ignores forwarded headers it can’t trust', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'One browser is enough for the address.');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, E2E.operative);
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Demo, fictional data')).toHaveCount(0);
  await context.close();
});

// Playwright needs the object pattern to pass `info`; this test uses no fixture.
// eslint-disable-next-line no-empty-pattern
test('the production build refuses to start with the demo link set', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Nothing to do with the browser.');
  const web = path.join(import.meta.dirname, '..');
  // As the Docker image runs it (the standalone server and the peer-address preload),
  // first without NODE_ENV in the environment, so the app's own check is the one that
  // stops it; then with NODE_ENV=production, as the image sets, which the preload stops.
  for (const nodeEnv of [undefined, 'production']) {
    const env: Record<string, string | undefined> = {
      ...process.env,
      NORTHKIT_DEMO_ORIGIN: 'https://northkit-demo.test',
    };
    delete env.NODE_ENV;
    if (nodeEnv) env.NODE_ENV = nodeEnv;
    const child = spawn(
      process.execPath,
      [path.join(web, 'scripts/serve-standalone.mjs'), '3233', '--no-copy'],
      { cwd: web, env: env as NodeJS.ProcessEnv },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 60_000);
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code, output).toBe(1);
    expect(output).toContain('NorthKit will not start: NORTHKIT_DEMO_ORIGIN is set');
  }
});
