import { createFreshDatabase } from '../src/migrate';
import { TEST_DB_NAME } from './helpers';

// Recreates the test database and migrates it once per `pnpm test` run, from empty:
// every run proves `pnpm db:migrate` works on an empty PostgreSQL 16 (S1-2).
export default async function setup(): Promise<void> {
  await createFreshDatabase(TEST_DB_NAME);
}
