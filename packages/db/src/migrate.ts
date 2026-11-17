import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { DB_ROLES, optionalEnv, requireEnv } from './config';
import { createPool } from './pool';
import { scramSha256Verifier } from './scram';

// Copied from NorthKeep main (944121d): the same forward-only runner (DB-11).

export const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// A migration that must run as the superuser (extensions, roles) starts with this line.
// Everything else runs as northkit_owner, so the objects it creates belong to that role.
const RUN_AS_ADMIN = '-- northkit:run-as-admin';

// Any fixed number works; it only has to be the same for every copy of the runner.
const MIGRATION_LOCK_KEY = 8_510_311;

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      if (!match)
        throw new Error(`Migration file name "${file}" must look like 0001_some_name.sql`);
      const sql = readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      return {
        version: match[1]!,
        name: match[2]!,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  name       text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.schema_migrations IS 'One row per SQL migration applied by the runner in packages/db. Forward-only: rows are never removed.';
COMMENT ON COLUMN public.schema_migrations.version IS 'Four-digit prefix of the migration file name; files apply in this order.';
COMMENT ON COLUMN public.schema_migrations.name IS 'Rest of the migration file name, without the .sql extension.';
COMMENT ON COLUMN public.schema_migrations.checksum IS 'SHA-256 of the file when applied. A different checksum later means an applied migration was edited, which the runner refuses.';
COMMENT ON COLUMN public.schema_migrations.applied_at IS 'When the migration was applied (UTC).';
`;

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

/**
 * Applies every migration not yet recorded in public.schema_migrations, each in
 * its own transaction. Safe to run repeatedly and from two places at once: an
 * advisory lock serialises runners. `client` must be a superuser connection.
 */
export async function migrate(
  client: pg.ClientBase,
  migrations: MigrationFile[] = readMigrations(),
): Promise<MigrateResult> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(BOOTSTRAP_SQL);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migrations',
    );
    const recorded = new Map(rows.map((row) => [row.version, row.checksum]));
    const applied: string[] = [];

    for (const migration of migrations) {
      const existing = recorded.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(
            `Migration ${migration.version}_${migration.name} was changed after it was applied. ` +
              'Migrations are forward-only: add a new migration instead.',
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        if (!migration.sql.startsWith(RUN_AS_ADMIN)) {
          await client.query(`SET LOCAL ROLE ${DB_ROLES.owner}`);
        }
        await client.query(migration.sql);
        await client.query('RESET ROLE');
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${migration.version}_${migration.name} failed and was rolled back: ${(error as Error).message}`,
          { cause: error },
        );
      }
      applied.push(`${migration.version}_${migration.name}`);
    }
    return { applied, alreadyApplied: migrations.length - applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

/**
 * Lets northkit_app (and optionally northkit_readonly) sign in with the passwords
 * from the environment. A blank readonly password keeps that role unable to sign in.
 */
export async function setRolePasswords(
  client: pg.ClientBase,
  passwords: { app: string; readonly?: string | undefined },
): Promise<void> {
  // ALTER ROLE can't take bound parameters. A verifier holds only base64, digits, $ and :.
  await client.query(
    `ALTER ROLE ${DB_ROLES.app} WITH LOGIN PASSWORD '${scramSha256Verifier(passwords.app)}'`,
  );
  if (passwords.readonly) {
    await client.query(
      `ALTER ROLE ${DB_ROLES.readonly} WITH LOGIN PASSWORD '${scramSha256Verifier(passwords.readonly)}'`,
    );
  } else {
    await client.query(`ALTER ROLE ${DB_ROLES.readonly} WITH NOLOGIN PASSWORD NULL`);
  }
}

const TEST_DB = /^northkit_[a-z0-9_]*(test|e2e)[a-z0-9_]*$/;

/**
 * Drops (if present), creates and migrates a database on the same server, with the
 * role passwords from the environment. For tests and the browser tests only; never
 * point it at a real install.
 */
export async function createFreshDatabase(name: string): Promise<void> {
  if (!TEST_DB.test(name))
    throw new Error('createFreshDatabase only makes northkit_*test* or northkit_*e2e* databases.');
  const server = createPool('admin', { database: 'postgres', max: 1 });
  try {
    await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await server.query(`CREATE DATABASE ${name}`);
  } finally {
    await server.end();
  }
  const pool = createPool('admin', { database: name, max: 1 });
  const client = await pool.connect();
  try {
    await migrate(client);
    await setRolePasswords(client, {
      app: requireEnv('NORTHKIT_APP_DB_PASSWORD'),
      readonly: optionalEnv('NORTHKIT_READONLY_DB_PASSWORD'),
    });
  } finally {
    client.release();
    await pool.end();
  }
}

/** Drops a database made by createFreshDatabase. */
export async function dropTestDatabase(name: string): Promise<void> {
  if (!TEST_DB.test(name)) throw new Error('Not a test database.');
  const server = createPool('admin', { database: 'postgres', max: 1 });
  try {
    await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await server.end();
  }
}
