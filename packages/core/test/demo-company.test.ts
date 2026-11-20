import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool, findRepoRoot } from '@northkit/db';
import {
  buildDemoItems,
  checkDemoCompany,
  DEMO_LOCATIONS,
  DEMO_SITES,
} from '../src/dev/demo-company';

// S2-6: the fictional demo company. Consistent, about 600 items, 15 to 20 kit sets, hired-in
// and retired items, and `pnpm db:seed-demo` run twice gives the same company.

describe('the demo company data', () => {
  const items = buildDemoItems();

  it('is consistent and about 600 items across 3 depots and 6 vans', () => {
    expect(checkDemoCompany(items)).toEqual([]);
    expect(items).toHaveLength(600);
    expect(DEMO_SITES).toHaveLength(3);
    expect(DEMO_LOCATIONS.filter((l) => l.kind === 'van')).toHaveLength(6);
  });

  it('has 15 to 20 kit sets, hired-in items, retired items and photos', () => {
    const kits = items.filter((i) => i.isKit);
    expect(kits.length).toBeGreaterThanOrEqual(15);
    expect(kits.length).toBeLessThanOrEqual(20);
    expect(items.filter((i) => i.kitTag).length).toBeGreaterThan(30);
    expect(items.some((i) => i.ownership === 'hired_in')).toBe(true);
    expect(items.filter((i) => i.retiredReason).length).toBeGreaterThanOrEqual(3);
    expect(items.filter((i) => i.photo).length).toBeGreaterThanOrEqual(20);
  });

  it('is the same every time it is built', () => {
    expect(JSON.stringify(buildDemoItems())).toBe(JSON.stringify(items));
  });

  it('uses only invented names: no real brand appears among makes', () => {
    const makes = new Set(items.map((i) => i.make));
    for (const real of ['Hilti', 'Milwaukee', 'DeWalt', 'Makita', 'Bosch', 'Stanley', 'Honda'])
      expect(makes.has(real)).toBe(false);
  });
});

describe('pnpm db:seed-demo', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'northkit-demo-files-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = () =>
    execFileSync(process.execPath, ['--import', 'tsx', 'packages/core/src/cli/seed-demo.ts'], {
      cwd: findRepoRoot(),
      env: {
        ...process.env,
        NORTHKIT_DB_NAME: 'northkit_demo_test',
        NORTHKIT_FILES_DIR: dir,
        SEED_DEMO_PASSWORD: 'demo-seed-test-password-123',
      },
      encoding: 'utf8',
    });

  const summary = async () => {
    const pool = createPool('admin', { database: 'northkit_demo_test', max: 1 });
    try {
      const { rows } = await pool.query<Record<string, string>>(`
        SELECT (SELECT count(*) FROM register.items) AS items,
               (SELECT count(*) FROM register.items WHERE is_kit) AS kits,
               (SELECT count(*) FROM register.items WHERE parent_id IS NOT NULL) AS parts,
               (SELECT count(*) FROM register.items WHERE ownership = 'hired_in') AS hired,
               (SELECT count(*) FROM register.items WHERE status = 'retired') AS retired,
               (SELECT count(*) FROM register.item_photos) AS photos,
               (SELECT sum(cost_pence) FROM register.items) AS cost,
               (SELECT count(*) FROM core.locations WHERE kind = 'van') AS vans,
               (SELECT count(*) FROM core.sites) AS depots,
               (SELECT string_agg(asset_number, ',' ORDER BY asset_number) FROM register.items) AS numbers,
               (SELECT count(*) FROM movements.movements) AS movements,
               (SELECT count(*) FROM register.items WHERE status = 'out') AS out,
               (SELECT count(*) FROM register.items WHERE status = 'out' AND overdue_at < now()) AS overdue,
               (SELECT count(*) FROM register.items WHERE status = 'missing') AS missing,
               (SELECT count(*) FROM movements.transfers WHERE status = 'in_transit') AS transit,
               (SELECT count(*) FROM movements.stocktakes WHERE status = 'closed') AS stocktakes,
               (SELECT string_agg(asset_number || ':' || status, ',' ORDER BY asset_number) FROM register.items) AS statuses,
               (SELECT count(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) FROM movements.movements) AS active_days`);
      return rows[0]!;
    } finally {
      await pool.end();
    }
  };

  it('stores the whole company, and running it twice gives the same result', async () => {
    const first = run();
    expect(first).toMatch(/seeded Fernbrook Contracting Ltd \(fictional\): 3 depots, 6 vans/);
    const a = await summary();
    expect(Number(a.items)).toBe(600);
    expect(Number(a.depots)).toBe(3);
    expect(Number(a.vans)).toBe(6);
    expect(Number(a.kits)).toBeGreaterThanOrEqual(15);
    expect(Number(a.parts)).toBeGreaterThan(30);
    expect(Number(a.photos)).toBeGreaterThanOrEqual(20);
    // Three months of history (S3-7): 10 to 15 items overdue, 3 missing, 2 transfers in transit,
    // a stocktake on each depot's store, and enough days of movements to draw a sparkline.
    expect(Number(a.movements)).toBeGreaterThan(700);
    expect(Number(a.overdue)).toBeGreaterThanOrEqual(10);
    expect(Number(a.overdue)).toBeLessThanOrEqual(15);
    expect(Number(a.missing)).toBe(3);
    expect(Number(a.transit)).toBe(2);
    expect(Number(a.stocktakes)).toBe(3);
    expect(Number(a.active_days)).toBeGreaterThan(40);
    const files = readdirSync(path.join(dir, 'items'), { recursive: true }).length;
    run();
    const b = await summary();
    expect(b).toEqual(a);
    expect(readdirSync(path.join(dir, 'items'), { recursive: true })).toHaveLength(files);
  }, 180_000);
});
