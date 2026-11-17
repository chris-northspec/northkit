import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the standalone production build, as the Docker image
// runs it, on databases recreated each run by e2e/global-setup.ts (never the dev one).
const PORT = 3230;
export const SETUP_PORT = 3231;
// The demo link works under the development server only (docs/demo-link.md), so its
// test (e2e/demo-link.spec.ts) has a `next dev` of its own on the same database.
export const DEMO_PORT = 3232;
export const DEMO_HOST = 'northkit-demo.test';
export const DEMO_ORIGIN = `http://${DEMO_HOST}:${DEMO_PORT}`;
export const E2E_DB_NAME = 'northkit_e2e';
export const SETUP_DB_NAME = 'northkit_e2e_setup';
process.env.NORTHKIT_DB_NAME = E2E_DB_NAME;
// A fresh set-up code per run for the first-run server. Set once here in the runner;
// workers inherit it.
process.env.E2E_SETUP_CODE ??= `E2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export const PROJECTS = ['desktop', 'phone-390x844'] as const;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // No retries: a test that needs one is a bug to fix (NorthCore S3-15).
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'auth-desktop', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['auth-desktop'],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: 'e2e/.auth/desktop.json',
      },
    },
    { name: 'auth-phone-390x844', testMatch: /auth\.setup\.ts/ },
    {
      name: 'phone-390x844',
      dependencies: ['auth-phone-390x844'],
      testIgnore: /auth\.setup\.ts/,
      use: {
        storageState: 'e2e/.auth/phone-390x844.json',
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      // The standalone production build. `pnpm build` first.
      command: `node scripts/serve-standalone.mjs ${PORT}`,
      // A readiness URL that needs no database: global setup may still be making it.
      url: `http://localhost:${PORT}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      env: { NORTHKIT_COOKIE_SECURE: 'false' },
      timeout: 120_000,
    },
    {
      // The development server with the demo link on, as `pnpm dev` runs on the demo PC.
      command: `node scripts/dev.mjs --port ${DEMO_PORT}`,
      url: `http://localhost:${DEMO_PORT}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      env: { NORTHKIT_COOKIE_SECURE: 'false', NORTHKIT_DEMO_ORIGIN: DEMO_ORIGIN },
      timeout: 180_000,
    },
    {
      // The same build on an empty database, for the first-run set-up test.
      command: `node scripts/serve-standalone.mjs ${SETUP_PORT} --no-copy`,
      url: `http://localhost:${SETUP_PORT}/manifest.webmanifest`,
      env: {
        NORTHKIT_DB_NAME: SETUP_DB_NAME,
        NORTHKIT_SETUP_CODE: process.env.E2E_SETUP_CODE,
        NORTHKIT_COOKIE_SECURE: 'false',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
