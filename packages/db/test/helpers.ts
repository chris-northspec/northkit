import type pg from 'pg';
import { createPool } from '../src/pool';

export const TEST_DB_NAME = process.env.NORTHKIT_TEST_DB_NAME ?? 'northkit_test';
if (!/^[a-z_][a-z0-9_]*$/.test(TEST_DB_NAME))
  throw new Error('NORTHKIT_TEST_DB_NAME must be a plain lower-case identifier');

/** Superuser pool on the test database: fixtures and inspection, bypasses RLS. */
export function adminPool(): pg.Pool {
  return createPool('admin', { database: TEST_DB_NAME, max: 4 });
}

/** northkit_app pool on the test database: what the running app gets. */
export function appPool(max = 4): pg.Pool {
  return createPool('app', { database: TEST_DB_NAME, max });
}

/** northkit_readonly pool on the test database: the reporting role. */
export function readonlyPool(): pg.Pool {
  return createPool('readonly', { database: TEST_DB_NAME, max: 2 });
}

/** A short random tag so fixtures from different test files never clash. */
export function tag(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Inserts a site as the superuser and returns its id. */
export async function insertSite(
  admin: pg.Pool,
  code: string,
  name = 'Test site',
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'INSERT INTO core.sites (code, name) VALUES ($1, $2) RETURNING id',
    [code, name],
  );
  return rows[0]!.id;
}
