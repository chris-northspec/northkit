import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { totpCode, totpStep } from '@northkit/core';

export const password = () => process.env.E2E_PASSWORD ?? '';
export const projectKey = (info: TestInfo) =>
  info.project.name.replace(/^auth-/, '').replace(/[^a-z0-9]/g, '');
/** The storage state the auth set-up saves for each project. */
export const authFile = (project: string) => `e2e/.auth/${project.replace(/^auth-/, '')}.json`;

/** A short random tag so records made by one run never clash with another's. */
export const runTag = () => Math.random().toString(36).slice(2, 7).toUpperCase();

export async function signIn(page: Page, email: string, pass = password()) {
  await page.goto('/login');
  // Hydrated first: on a busy machine the development server (the demo link's tests)
  // hydrates late, and a click before then submits the plain form and reloads it empty.
  await ready(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A code for the next time step, so it is never one already used this step. */
export function nextCode(secret: string): string {
  return totpCode(secret, totpStep() + 1);
}

export async function expectNoSideways(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Elements inside a scrolling or clipped box (a table region) don't widen the page.
    const contained = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX !== 'visible' || o.clip !== 'auto' || o.position === 'absolute')
          return true;
      }
      return false;
    };
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !contained(el))
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return { by: document.documentElement.scrollWidth - width, wide };
  });
  expect(overflow, `${new URL(page.url()).pathname} is wider than the screen`).toEqual({
    by: 0,
    wide: [],
  });
}

/**
 * Waits until React has hydrated the page (components/hydrated.tsx), so typing isn't lost
 * and a click reaches React, not the plain form. Never `networkidle`: under the development
 * server the network never goes quiet, which is what made demo-link.spec.ts time out.
 */
export async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true', null, {
    timeout: 90_000,
  });
}

/**
 * WCAG 2.2 AA checks with axe (S1-10). Run from the top of the page: otherwise axe's
 * target-size rule flags whichever link a test's last click happened to scroll under the
 * sticky top bar, which depends on the scroll position, not the layout. Fixed elements
 * (the phone's floating Report button) cover the page at every scroll position and are
 * still checked. The scroll position is put back afterwards.
 */
export async function expectAccessible(page: Page) {
  const scrolled = await page.evaluate(() => {
    const y = window.scrollY;
    window.scrollTo(0, 0);
    return y;
  });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await page.evaluate((y) => window.scrollTo(0, y), scrolled);
  expect(
    results.violations.map((v) => ({
      id: v.id,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([]);
}

/**
 * Every visible button, link-styled button and form control in the shell is at least
 * 44 x 44 px, for gloved hands (CLAUDE.md). Inline text links in sentences are exempt.
 */
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      '.button, button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .nav-list a, .breadcrumbs a, td a',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.visually-hidden')) continue;
      // Hidden until focused, like the site filter's Show; full size once it has focus.
      if (getComputedStyle(el).clip === 'rect(0px, 0px, 0px, 0px)') continue;
      if (r.height < 43.5 || r.width < 43.5)
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
    }
    return out;
  });
  expect(small).toEqual([]);
}

/** Our own alert (Next adds an empty route-announcer alert too), matched by text. */
export const alertWith = (page: Page, text: string | RegExp) =>
  page.getByRole('alert').filter({ hasText: text });

/** Opens the phone menu when it is folded away. */
export async function openMenu(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  }
}

// ---------------------------------------------------------------- database fixtures (S3)
// Items and counts for the movement journeys are made straight in the e2e database, so each
// test has kit of its own with known asset numbers and nothing depends on another test's.

import { createPool } from '@northkit/db';
import { E2E_DB_NAME } from '../playwright.config';

export interface MadeItem {
  id: string;
  asset: string;
}

/** Runs `fn` against the e2e database as the superuser (fixtures only: it bypasses RLS). */
export async function withDb<T>(
  fn: (pool: ReturnType<typeof createPool>) => Promise<T>,
): Promise<T> {
  const pool = createPool('admin', { database: E2E_DB_NAME, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Makes `count` power tools at depot A, in the given location (the main store by default). */
export async function makeItems(
  count: number,
  tag: string,
  options: { location?: string; depot?: 'E2E-A' | 'E2E-B' } = {},
): Promise<MadeItem[]> {
  return withDb(async (pool) => {
    const site = (
      await pool.query('SELECT id FROM core.sites WHERE code = $1', [options.depot ?? 'E2E-A'])
    ).rows[0]!.id;
    const location = (
      await pool.query('SELECT id FROM core.locations WHERE code = $1 AND site_id = $2', [
        options.location ?? 'A-STORE',
        site,
      ])
    ).rows[0]!.id;
    const kind = (await pool.query(`SELECT id FROM register.kinds WHERE name = 'Power tool'`))
      .rows[0]!.id;
    const out: MadeItem[] = [];
    for (let n = 1; n <= count; n++) {
      const asset = `MV-${tag}-${n}`;
      const row = await pool.query(
        `INSERT INTO register.items (site_id, kind_id, asset_number, location_id, description) VALUES ($1, $2, $3, $4, 'Cordless drill') RETURNING id`,
        [site, kind, asset, location],
      );
      out.push({ id: row.rows[0]!.id, asset });
    }
    return out;
  });
}

/** A new store at depot A with its own items: a stocktake of it has known expectations. */
export async function makeStore(
  tag: string,
  itemCount: number,
): Promise<{ name: string; items: MadeItem[] }> {
  const name = `Count store ${tag}`;
  await withDb(async (pool) => {
    const site = (await pool.query(`SELECT id FROM core.sites WHERE code = 'E2E-A'`)).rows[0]!.id;
    await pool.query(
      `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', $2, $3)`,
      [site, `CNT-${tag}`, name],
    );
  });
  return { name, items: await makeItems(itemCount, tag, { location: `CNT-${tag}` }) };
}

export async function itemRow(
  id: string,
): Promise<{ status: string; holder: string | null; location: string | null; site: string }> {
  return withDb(async (pool) => {
    const r = await pool.query(
      `SELECT i.status, u.email AS holder, l.code AS location, s.code AS site
         FROM register.items i LEFT JOIN core.users u ON u.id = i.holder_user_id
         LEFT JOIN core.locations l ON l.id = i.location_id JOIN core.sites s ON s.id = i.site_id WHERE i.id = $1`,
      [id],
    );
    return r.rows[0] as never;
  });
}

/** Scanner targets are at least 56 px, for gloves (standard 13, scanner screens). */
export async function expectBigTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.scan-btn')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 55.5)
        out.push(`${(el.textContent ?? '').trim().slice(0, 30)} ${Math.round(r.height)}px`);
    }
    return out;
  });
  expect(small).toEqual([]);
}
