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

/** Waits until the page has hydrated and gone quiet, so input isn't overwritten. */
export async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
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
