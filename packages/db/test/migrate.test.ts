import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, readMigrations, type MigrationFile } from '../src/migrate';
import { adminPool } from './helpers';

let pool: pg.Pool;
let client: pg.PoolClient;

beforeAll(async () => {
  pool = adminPool();
  client = await pool.connect();
});

afterAll(async () => {
  client.release();
  await pool.end();
});

function fakeMigration(version: string, sql: string): MigrationFile {
  return { version, name: 'test_only', sql, checksum: `test-${version}-${sql.length}` };
}

describe('migration runner (S1-2, DB-11)', () => {
  it('records every migration file in public.schema_migrations', async () => {
    const files = readMigrations();
    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM public.schema_migrations ORDER BY version',
    );
    expect(rows.map((row) => row.version)).toEqual(files.map((file) => file.version));
  });

  it('is idempotent: a second run applies nothing', async () => {
    const result = await migrate(client);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(readMigrations().length);
  });

  it('refuses a migration that was edited after it was applied', async () => {
    const [first, ...rest] = readMigrations();
    const edited = { ...first!, checksum: 'edited' };
    await expect(migrate(client, [edited, ...rest])).rejects.toThrow(/forward-only/);
  });

  it('rolls a failed migration back completely and does not record it', async () => {
    const broken = fakeMigration(
      '9998',
      'CREATE TABLE core.half_done (id int); SELECT * FROM core.no_such_table;',
    );
    await expect(migrate(client, [...readMigrations(), broken])).rejects.toThrow(/9998_test_only/);
    const table = await client.query("SELECT to_regclass('core.half_done') AS t");
    expect(table.rows[0].t).toBeNull();
    const recorded = await client.query(
      "SELECT 1 FROM public.schema_migrations WHERE version = '9998'",
    );
    expect(recorded.rowCount).toBe(0);
  });

  it('runs ordinary migrations as northkit_owner so the owner role owns new objects', async () => {
    const probe = fakeMigration('9999', 'CREATE TABLE core.ownership_probe (id int);');
    await migrate(client, [...readMigrations(), probe]);
    const { rows } = await client.query(
      "SELECT tableowner FROM pg_tables WHERE schemaname = 'core' AND tablename = 'ownership_probe'",
    );
    expect(rows[0].tableowner).toBe('northkit_owner');
    await client.query('DROP TABLE core.ownership_probe');
    await client.query("DELETE FROM public.schema_migrations WHERE version = '9999'");
  });
});

describe('0001_foundation (DB-01 to DB-04)', () => {
  it('creates one schema per module (DB-02)', async () => {
    const expected = ['audit', 'core', 'register', 'reporting'];
    const { rows } = await client.query<{ nspname: string }>(
      'SELECT nspname FROM pg_namespace WHERE nspname = ANY($1) ORDER BY nspname',
      [expected],
    );
    expect(rows.map((r) => r.nspname)).toEqual(expected);
  });

  it('runs on PostgreSQL 16 or later with ltree (DB-01)', async () => {
    const { rows } = await client.query(
      "SELECT current_setting('server_version_num')::int AS v, (SELECT count(*)::int FROM pg_extension WHERE extname = 'ltree') AS ltree",
    );
    expect(rows[0].v).toBeGreaterThanOrEqual(160000);
    expect(rows[0].ltree).toBe(1);
  });

  it('creates the three roles and none of them can bypass RLS', async () => {
    const { rows } = await client.query(
      "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname LIKE 'northkit\\_%' ORDER BY rolname",
    );
    expect(rows).toEqual([
      { rolname: 'northkit_app', rolbypassrls: false, rolsuper: false },
      { rolname: 'northkit_owner', rolbypassrls: false, rolsuper: false },
      { rolname: 'northkit_readonly', rolbypassrls: false, rolsuper: false },
    ]);
  });

  it('uuid_v7() returns version-7 ids in creation order (DB-03)', async () => {
    const { rows } = await client.query<{ id: string }>(
      'SELECT public.uuid_v7()::text AS id FROM generate_series(1, 3) ORDER BY 1',
    );
    for (const { id } of rows)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const first = await client.query<{ id: string }>('SELECT public.uuid_v7()::text AS id');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await client.query<{ id: string }>('SELECT public.uuid_v7()::text AS id');
    expect(first.rows[0]!.id < second.rows[0]!.id).toBe(true);
  });

  it('maintains updated_at and row_version, and protects created_* (DB-04)', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TEMP TABLE probe (
          id uuid PRIMARY KEY DEFAULT public.uuid_v7(), note text,
          created_at timestamptz NOT NULL, created_by uuid, updated_at timestamptz NOT NULL,
          updated_by uuid, row_version integer NOT NULL)`);
      await client.query(
        'CREATE TRIGGER standard_columns BEFORE INSERT OR UPDATE ON probe FOR EACH ROW EXECUTE FUNCTION public.maintain_standard_columns()',
      );
      const user = '0190f0c0-0000-7000-8000-000000000001';
      await client.query("SELECT set_config('app.user_id', $1, true)", [user]);
      const inserted = await client.query(
        "INSERT INTO probe (note, row_version) VALUES ('a', 42) RETURNING *",
      );
      expect(inserted.rows[0]).toMatchObject({
        row_version: 1,
        created_by: user,
        updated_by: user,
      });
      const updated = await client.query(
        "UPDATE probe SET note = 'b', row_version = 99, created_at = '2000-01-01' RETURNING *",
      );
      expect(updated.rows[0].row_version).toBe(2);
      expect(updated.rows[0].created_at).toEqual(inserted.rows[0].created_at);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('treats a missing site scope as no sites (fail closed)', async () => {
    const { rows } = await client.query('SELECT public.current_site_ids() AS ids');
    expect(rows[0].ids).toEqual([]);
  });

  it('follows the naming rules: snake_case plural tables, uuid id primary keys (DB-03)', async () => {
    const { rows } = await client.query<{ name: string; id_type: string | null }>(`
      SELECT format('%s.%s', n.nspname, c.relname) AS name,
             (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'id') AS id_type
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND n.nspname IN ('core', 'register', 'audit')`);
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.name, row.name).toMatch(/^[a-z]+\.[a-z_]+s$/);
      expect(row.id_type, row.name).toBe('uuid');
    }
  });
});
