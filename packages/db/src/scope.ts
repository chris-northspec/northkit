import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import type pg from 'pg';
import type { Database } from './schema';

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function assertUuid(value: string, what: string): void {
  if (!UUID.test(value)) throw new Error(`${what} must be a UUID`);
}

export interface Scope {
  /** Sites this unit of work may see and write. Empty means none. */
  siteIds: readonly string[];
  /** User acting, recorded in created_by / updated_by and the audit trail. */
  userId?: string | null;
  /**
   * Run the transaction READ ONLY, so PostgreSQL itself refuses every write. Used
   * when the licence has lapsed (S1-7): everything stays visible and exportable.
   */
  readOnly?: boolean;
}

/** SQLSTATE PostgreSQL raises for a write inside a READ ONLY transaction. */
export const READ_ONLY_SQLSTATE = '25006';

export function isReadOnlyViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === READ_ONLY_SQLSTATE;
}

/**
 * Runs `fn` in a transaction whose row-level security scope is `scope`.
 * Both settings are transaction-local (set_config(..., true)), so they end with
 * the transaction and can never leak to the next user of a pooled connection.
 * Every query on site-owned data must run inside this (DB-06).
 */
export async function withScope<T>(db: Db, scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (const id of scope.siteIds) assertUuid(id, 'Site id');
  if (scope.userId) assertUuid(scope.userId, 'User id');
  const siteIds = `{${scope.siteIds.join(',')}}`;
  return db.transaction().execute(async (tx) => {
    if (scope.readOnly) await sql`SET TRANSACTION READ ONLY`.execute(tx);
    await sql`SELECT set_config('app.site_ids', ${siteIds}, true),
                     set_config('app.user_id', ${scope.userId ?? ''}, true)`.execute(tx);
    return fn(tx);
  });
}

/**
 * Records who is acting for the rest of a transaction that started without a
 * scope (sign-in, where the user is only known after the lookup).
 */
export async function setActingUser(tx: Tx, userId: string): Promise<void> {
  assertUuid(userId, 'User id');
  await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(tx);
}
