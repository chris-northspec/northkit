import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/worker/test/**/*.test.ts',
      'apps/web/test/**/*.test.ts',
    ],
    globalSetup: ['packages/db/test/global-setup.ts'],
    // Integration tests share one Postgres database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
