import { createDb, type Db } from '@northkit/db';
import type pg from 'pg';
import { adminPool, appPool } from '../../db/test/helpers';
import { hashPassword } from '../src/auth/password';
import { loadActor } from '../src/auth/sessions';
import type { ActorContext } from '../src/context';

// Shared set-up for core tests: superuser fixtures, the app-role Kysely instance the
// services use, and actors built exactly as a session builds them.

export const PASSWORD = 'correct horse battery staple';

export interface Fixtures {
  admin: pg.Pool;
  db: Db;
  tag: string;
  close(): Promise<void>;
  site(code?: string, name?: string): Promise<string>;
  user(options?: {
    roles?: string[];
    allSites?: boolean;
    siteIds?: string[];
    mfa?: boolean;
  }): Promise<{
    id: string;
    email: string;
    row_version: number;
  }>;
  /** The actor a session would build for this user right now. */
  actor(userId: string, options?: { readOnly?: boolean }): Promise<ActorContext>;
}

let hashed: Promise<string> | undefined;

export function fixtures(): Fixtures {
  const admin = adminPool();
  const db = createDb(appPool());
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  let counter = 0;
  return {
    admin,
    db,
    tag,
    async close() {
      await db.destroy();
      await admin.end();
    },
    async site(code, name = 'Test site') {
      counter += 1;
      const { rows } = await admin.query<{ id: string }>(
        'INSERT INTO core.sites (code, name) VALUES ($1, $2) RETURNING id',
        [code ?? `S${counter}${tag}`, name],
      );
      return rows[0]!.id;
    },
    async user(options = {}) {
      counter += 1;
      const email = `user${counter}.${tag.toLowerCase()}@northkit.test`;
      hashed ??= hashPassword(PASSWORD);
      const { rows } = await admin.query<{ id: string; row_version: number }>(
        `INSERT INTO core.users (email, display_name, password_hash, all_sites)
         VALUES ($1, $2, $3, $4) RETURNING id, row_version`,
        [email, `User ${counter}`, await hashed, options.allSites ?? false],
      );
      const user = rows[0]!;
      for (const role of options.roles ?? [])
        await admin.query(
          `INSERT INTO core.user_roles (user_id, role_id) SELECT $1, id FROM core.roles WHERE code = $2`,
          [user.id, role],
        );
      for (const siteId of options.siteIds ?? [])
        await admin.query('INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)', [
          user.id,
          siteId,
        ]);
      if (options.mfa)
        await admin.query(
          `UPDATE core.users SET mfa_secret_encrypted = 'v1.x.x.x', mfa_enabled_at = now() WHERE id = $1`,
          [user.id],
        );
      return { ...user, email };
    },
    async actor(userId, options = {}) {
      const { rows } = await admin.query<{ all_sites: boolean }>(
        'SELECT all_sites FROM core.users WHERE id = $1',
        [userId],
      );
      return db
        .transaction()
        .execute((tx) => loadActor(tx, userId, { allSites: rows[0]!.all_sites }, options));
    },
  };
}
