import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRlsProblems, siteOwnedTables } from '../src/rls-check';
import { adminPool, appPool, readonlyPool, tag } from './helpers';

// S1-5 (DB-06): an isolation test for EVERY site-owned table. The list of tables comes
// from the database itself, and each needs an entry in FIXTURES below, so a new
// site-owned table without an isolation test fails this file. Sprint 2 onwards adds its
// tables (items, check-outs, inspections) here as it creates them.
//
// Every attempt runs as northkit_app, the role the app uses, scoped to site A:
//   read    rows of site B are invisible
//   insert  a row for site B is refused by RLS
//   update  rows of site B can't be touched (0 rows)
//   move    a site A row can't be moved to site B
//   delete  rows of site B can't be deleted (0 rows), where the app may delete at all

interface SiteRefs {
  siteId: string;
  locationId: string;
  /** An item at the depot, for rows that point at one. */
  itemId: string;
}

interface Shared {
  users: string[];
  roles: string[];
  kindId: string;
}

interface Fixture {
  /** INSERT ... RETURNING id for a row of `site`; `n` keeps unique keys apart. */
  insert: (site: SiteRefs, shared: Shared, n: number) => [string, unknown[]];
  /** A harmless SET clause for the update attempt; null if the table is append-only. */
  touch: string | null;
  /** Column holding the site; site_id unless the table is the site itself. */
  siteColumn?: string;
  /** True if northkit_app has DELETE on the table. */
  deletable?: boolean;
}

const FIXTURES: Record<string, Fixture> = {
  'core.sites': {
    insert: (_s, _sh, n) => [
      'INSERT INTO core.sites (code, name) VALUES ($1, $2) RETURNING id',
      [`ISO${n}${tag()}`, 'Isolation probe'],
    ],
    touch: 'name = name',
    siteColumn: 'id',
  },
  'core.locations': {
    insert: (s, _sh, n) => [
      `INSERT INTO core.locations (site_id, kind, code, name)
       VALUES ($1, 'van', $2, 'Probe van') RETURNING id`,
      [s.siteId, `LX${n}`],
    ],
    touch: 'name = name',
  },
  'core.user_sites': {
    insert: (s, sh, n) => [
      'INSERT INTO core.user_sites (site_id, user_id) VALUES ($1, $2) RETURNING id',
      [s.siteId, sh.users[n]],
    ],
    touch: 'user_id = user_id',
    deletable: true,
  },
  'core.role_sites': {
    insert: (s, sh, n) => [
      'INSERT INTO core.role_sites (site_id, role_id) VALUES ($1, $2) RETURNING id',
      [s.siteId, sh.roles[n]],
    ],
    touch: 'role_id = role_id',
    deletable: true,
  },
  'register.items': {
    insert: (s, sh, n) => [
      'INSERT INTO register.items (site_id, kind_id, asset_number) VALUES ($1, $2::uuid, $3) RETURNING id',
      [s.siteId, sh.kindId, `ISO${n}${t}`],
    ],
    touch: 'notes = notes',
  },
  'register.item_photos': {
    insert: (s) => [
      `INSERT INTO register.item_photos (site_id, item_id, content_type, byte_size, width, height, sha256, storage_key)
       VALUES ($1, $2::uuid, 'image/jpeg', 100, 10, 10, repeat('a', 64), 'items/' || $2::text || '/' || public.uuid_v7() || '.jpg') RETURNING id`,
      [s.siteId, s.itemId],
    ],
    touch: 'sort_order = sort_order',
    deletable: true,
  },
  'audit.audit_events': {
    insert: (s) => [
      `INSERT INTO audit.audit_events (action, entity_type, site_id)
       VALUES ('test.isolation.probe', 'test.probe', $1) RETURNING id`,
      [s.siteId],
    ],
    touch: null,
  },
};

let admin: pg.Pool;
let app: pg.Pool;
const t = tag();
const shared: Shared = { users: [], roles: [], kindId: '' };
let siteA: SiteRefs;
let siteB: SiteRefs;

/** table -> the id of its site A row and its site B row. */
const rowIds: Record<string, { a: string; b: string }> = {};

async function siteRefs(code: string): Promise<SiteRefs> {
  const site = await admin.query<{ id: string }>(
    'INSERT INTO core.sites (code, name) VALUES ($1, $2) RETURNING id',
    [code, `Site ${code}`],
  );
  const siteId = site.rows[0]!.id;
  const location = await admin.query<{ id: string }>(
    `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', 'Z1', 'Z1 store') RETURNING id`,
    [siteId],
  );
  const item = await admin.query<{ id: string }>(
    'INSERT INTO register.items (site_id, kind_id, asset_number) VALUES ($1, $2::uuid, $3) RETURNING id',
    [siteId, shared.kindId, `BASE-${code}`],
  );
  return { siteId, locationId: location.rows[0]!.id, itemId: item.rows[0]!.id };
}

/** Runs `fn` as northkit_app with app.site_ids set, as the app does. */
async function asApp<T>(siteIds: string[], fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.site_ids', $1, true)", [`{${siteIds.join(',')}}`]);
    try {
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  app = appPool();
  for (let i = 0; i < 4; i++) {
    shared.users.push(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO core.users (email, display_name) VALUES ($1, 'Iso user') RETURNING id`,
          [`iso${i}.${t.toLowerCase()}@northkit.test`],
        )
      ).rows[0]!.id,
    );
    shared.roles.push(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO core.roles (code, name) VALUES ($1, $2) RETURNING id`,
          [`iso_${i}_${t.toLowerCase()}`, `Iso role ${i} ${t}`],
        )
      ).rows[0]!.id,
    );
  }
  shared.kindId = (
    await admin.query<{ id: string }>('SELECT id FROM register.kinds ORDER BY name LIMIT 1')
  ).rows[0]!.id;
  siteA = await siteRefs(`A${t}`);
  siteB = await siteRefs(`B${t}`);
  for (const [table, fixture] of Object.entries(FIXTURES)) {
    if (table === 'core.sites') {
      rowIds[table] = { a: siteA.siteId, b: siteB.siteId };
      continue;
    }
    const [sqlA, paramsA] = fixture.insert(siteA, shared, 0);
    const [sqlB, paramsB] = fixture.insert(siteB, shared, 1);
    rowIds[table] = {
      a: (await admin.query<{ id: string }>(sqlA, paramsA)).rows[0]!.id,
      b: (await admin.query<{ id: string }>(sqlB, paramsB)).rows[0]!.id,
    };
  }
});

afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('site isolation coverage', () => {
  it('has an isolation fixture for every site-owned table, and no stale ones', async () => {
    const tables = await siteOwnedTables(admin);
    expect(tables.sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it('passes the RLS coverage check (forced RLS, site_isolation, reporting_read, no bypass)', async () => {
    expect(await findRlsProblems(admin)).toEqual([]);
  });

  it('gives northkit_app no BYPASSRLS and no superuser', async () => {
    const { rows } = await admin.query(
      "SELECT rolbypassrls, rolsuper, rolinherit FROM pg_roles WHERE rolname = 'northkit_app'",
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolinherit: false });
  });

  it('detects a site-owned table without RLS', async () => {
    await admin.query('CREATE TABLE core.probes (id uuid, site_id uuid)');
    try {
      const problems = await findRlsProblems(admin);
      expect(problems).toContainEqual({
        table: 'core.probes',
        problems: expect.arrayContaining(['row-level security is not enabled']),
      });
    } finally {
      await admin.query('DROP TABLE core.probes');
    }
  });
});

describe.each(Object.keys(FIXTURES))('isolation: %s', (table) => {
  const fixture = FIXTURES[table]!;
  const siteColumn = fixture.siteColumn ?? 'site_id';

  it('shows site B rows only to a site B scope', async () => {
    const ids = rowIds[table]!;
    const visible = async (scope: string[]) =>
      asApp(scope, async (c) =>
        (
          await c.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1) ORDER BY id`, [
            [ids.a, ids.b],
          ])
        ).rows.map((r) => r.id),
      );
    expect(await visible([siteA.siteId])).toEqual([ids.a]);
    expect(await visible([siteB.siteId])).toEqual([ids.b]);
    expect(await visible([])).toEqual([]);
  });

  it('refuses to insert a site B row from a site A scope', async () => {
    const [sql, params] = fixture.insert(siteB, shared, 2);
    await asApp([siteA.siteId], async (c) => {
      await expect(c.query(sql, params)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it.skipIf(fixture.touch === null)('cannot update a site B row from a site A scope', async () => {
    const result = await asApp([siteA.siteId], (c) =>
      c.query(`UPDATE ${table} SET ${fixture.touch} WHERE id = $1`, [rowIds[table]!.b]),
    );
    expect(result.rowCount).toBe(0);
  });

  it.skipIf(fixture.touch === null || siteColumn === 'id')(
    'cannot move a site A row to site B',
    async () => {
      await asApp([siteA.siteId], async (c) => {
        await expect(
          c.query(`UPDATE ${table} SET ${siteColumn} = $1 WHERE id = $2`, [
            siteB.siteId,
            rowIds[table]!.a,
          ]),
        ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/) });
      });
    },
  );

  it.skipIf(!fixture.deletable)('cannot delete a site B row from a site A scope', async () => {
    const result = await asApp([siteA.siteId], (c) =>
      c.query(`DELETE FROM ${table} WHERE id = $1`, [rowIds[table]!.b]),
    );
    expect(result.rowCount).toBe(0);
  });
});

describe('reporting role (DB-10)', () => {
  it('reads every site through the reporting views, and nothing else', async () => {
    const ro = readonlyPool();
    try {
      const { rows } = await ro.query(
        'SELECT site_id FROM reporting.sites WHERE site_id = ANY($1)',
        [[siteA.siteId, siteB.siteId]],
      );
      expect(rows).toHaveLength(2);
      const view = await ro.query(
        'SELECT location_code FROM reporting.locations WHERE site_code = $1',
        [`A${t}`],
      );
      expect(view.rows.map((r) => r.location_code)).toContain('Z1');
      // Every view the role is given, it can read.
      const views = await ro.query<{ name: string }>(
        `SELECT format('%I.%I', schemaname, viewname) AS name FROM pg_views WHERE schemaname = 'reporting'`,
      );
      expect(views.rows.length).toBeGreaterThanOrEqual(2);
      for (const { name } of views.rows) await ro.query(`SELECT * FROM ${name} LIMIT 1`);
      // No table outside the views, not even the sites table, and no writes.
      for (const sql of [
        'SELECT id FROM core.sites LIMIT 1',
        'SELECT id FROM audit.audit_events LIMIT 1',
        'SELECT password_hash FROM core.users LIMIT 1',
        'SELECT token_hash FROM core.sessions LIMIT 1',
      ])
        await expect(ro.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      await expect(
        ro.query(`UPDATE core.sites SET name = name WHERE id = $1`, [siteA.siteId]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await ro.end();
    }
  });

  it('the app role cannot read the views (they would step round its row-level security)', async () => {
    await expect(
      asApp([siteA.siteId], (c) => c.query('SELECT * FROM reporting.locations LIMIT 1')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('composite keys (DB-06)', () => {
  it('refuses a location in site A with a parent in site B', async () => {
    await expect(
      admin.query(
        `INSERT INTO core.locations (site_id, parent_id, kind, code, name) VALUES ($1, $2::uuid, 'store', 'XP', 'X')`,
        [siteA.siteId, siteB.locationId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps a location path in step with its parent, and moves the subtree with it', async () => {
    const child = await admin.query<{ id: string; path: string }>(
      `INSERT INTO core.locations (site_id, parent_id, kind, code, name) VALUES ($1, $2::uuid, 'store', 'ZC', 'Cage') RETURNING id, path::text`,
      [siteA.siteId, siteA.locationId],
    );
    const parentPath = (
      await admin.query<{ path: string }>('SELECT path::text FROM core.locations WHERE id = $1', [
        siteA.locationId,
      ])
    ).rows[0]!.path;
    expect(child.rows[0]!.path).toBe(`${parentPath}.${child.rows[0]!.id.replaceAll('-', '')}`);
    await expect(
      admin.query('UPDATE core.locations SET parent_id = $1 WHERE id = $2', [
        child.rows[0]!.id,
        siteA.locationId,
      ]),
    ).rejects.toMatchObject({ constraint: 'locations_no_cycle' });
  });
});
