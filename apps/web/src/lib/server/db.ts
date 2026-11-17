import 'server-only';
import { createDb, createPool, type Db } from '@northkit/db';

// One pool per server process. Next's dev server reloads modules, so the pool is
// kept on globalThis to avoid opening a new one on every edit.
const globalForDb = globalThis as unknown as { northkitDb?: Db };

export function db(): Db {
  globalForDb.northkitDb ??= createDb(createPool('app', { max: 10 }));
  return globalForDb.northkitDb;
}
