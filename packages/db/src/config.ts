import { existsSync } from 'node:fs';
import path from 'node:path';

let envLoaded = false;

/**
 * Loads deploy/.env (if present) into process.env once. Values already in the
 * environment win, so Docker and CI settings are never overridden by the file.
 */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const file = path.join(findRepoRoot(), 'deploy', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export type DbRole = 'admin' | 'app' | 'readonly';

export interface ConnectionSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Add it to deploy/.env (see deploy/.env.example).`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  loadEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** The database roles the product creates (migration 0001). */
export const DB_ROLES = {
  owner: 'northkit_owner',
  app: 'northkit_app',
  readonly: 'northkit_readonly',
} as const;

/**
 * Connection settings for one of the three database roles. `admin` is the
 * PostgreSQL superuser and is only for migrations, seeding and test set-up.
 */
export function connectionSettings(
  role: DbRole,
  overrides: Partial<ConnectionSettings> = {},
): ConnectionSettings {
  const base = {
    host: optionalEnv('NORTHKIT_DB_HOST') ?? 'localhost',
    port: Number(optionalEnv('NORTHKIT_DB_PORT') ?? 5450),
    database: optionalEnv('NORTHKIT_DB_NAME') ?? 'northkit',
  };
  const credentials =
    role === 'admin'
      ? {
          user: optionalEnv('POSTGRES_USER') ?? 'postgres',
          password: requireEnv('POSTGRES_PASSWORD'),
        }
      : role === 'app'
        ? { user: DB_ROLES.app, password: requireEnv('NORTHKIT_APP_DB_PASSWORD') }
        : { user: DB_ROLES.readonly, password: requireEnv('NORTHKIT_READONLY_DB_PASSWORD') };
  return { ...base, ...credentials, ...overrides };
}
