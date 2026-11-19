import { sql, type Db } from '@northkit/db';

// Scheduled housekeeping, run by the worker (copied from NorthCore WMS).

/** Keeps the audit and movement partitions three months ahead of today. Returns how many it created. */
export async function rollAuditPartitions(db: Db): Promise<number> {
  const { rows } = await sql<{
    created: number;
  }>`SELECT audit.ensure_partitions(3) AS created`.execute(db);
  const movements = await sql<{
    created: number;
  }>`SELECT movements.ensure_partitions(6, 3) AS created`.execute(db);
  return (rows[0]?.created ?? 0) + (movements.rows[0]?.created ?? 0);
}

/** Deletes sessions that ended more than a week ago; recent ones stay for investigation. */
export async function deleteOldSessions(db: Db): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await db
    .deleteFrom('core.sessions')
    .where((eb) => eb.or([eb('expires_at', '<', weekAgo), eb('revoked_at', '<', weekAgo)]))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
