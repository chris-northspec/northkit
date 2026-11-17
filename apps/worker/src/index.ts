import { connectionSettings, createDb, createPool } from '@northkit/db';
import { deleteOldSessions, rollAuditPartitions } from '@northkit/core';
import { PgBoss } from 'pg-boss';
import { log } from './log';

// Scheduled jobs (copied from NorthKeep main, 944121d). The queue lives in PostgreSQL
// (schema pgboss), so there is nothing else to install. Times are UTC. Later sprints add
// their jobs here: inspection and certificate reminders, overdue returns.
const pool = createPool('app', { max: 3 });
const db = createDb(pool);

const JOBS = [
  { name: 'audit-roll-partitions', cron: '15 1 * * *', run: () => rollAuditPartitions(db) },
  { name: 'sessions-delete-old', cron: '30 1 * * *', run: () => deleteOldSessions(db) },
] as const;

const boss = new PgBoss({
  ...connectionSettings('app'),
  schema: 'pgboss',
  // Migration 0001 creates the schema (owned by northkit_app); the app role can't create schemas.
  createSchema: false,
  application_name: 'northkit-worker',
  max: 4,
  options: '-c TimeZone=UTC',
  openTelemetry: { enabled: false },
});
boss.on('error', (error: Error) => log('error', 'queue error', { error: error.message }));

await boss.start();
for (const job of JOBS) {
  await boss.createQueue(job.name);
  await boss.schedule(job.name, job.cron);
  await boss.work(job.name, async () => {
    const count = await job.run();
    if (count) log('info', 'job finished', { job: job.name, count });
  });
  // Run once at start-up as well, so nothing waits for the first tick.
  log('info', 'job finished', { job: job.name, count: await job.run(), at: 'startup' });
}
log('info', 'worker started', { jobs: JOBS.map((job) => job.name) });

async function shutdown(signal: string): Promise<void> {
  log('info', 'worker stopping', { signal });
  await boss.stop({ graceful: true });
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
