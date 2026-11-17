import { randomBytes } from 'node:crypto';
import { createPool } from '@northkit/db';
import { createFreshDatabase } from '@northkit/db/migrate';
import { generateTotpSecret, hashPassword } from '@northkit/core';
// The secret box reads NORTHKIT_SECRET_KEY, the same key the web server uses.
import { sealSecret } from '../../../packages/core/src/auth/secret-box';
import { E2E_DB_NAME, PROJECTS, SETUP_DB_NAME } from '../playwright.config';

export const E2E = {
  /** One administrator per project, each with two-factor on, so codes never collide. */
  admin: (project: string) => `e2e.admin.${project.replace(/[^a-z0-9]/g, '')}@northkit.test`,
  /** Kit Manager at depot E2E-A only, and the depot's manager. */
  manager: 'e2e.manager@northkit.test',
  /** Operative at depot E2E-A: checks kit out and in, nothing else. */
  operative: 'e2e.operative@northkit.test',
  /** Administrator without two-factor yet: forced to set it up. */
  newAdmin: (project: string) => `e2e.newadmin.${project.replace(/[^a-z0-9]/g, '')}@northkit.test`,
  /** Supervisor at E2E-A who must change their password at next sign-in. */
  mustChange: (project: string) =>
    `e2e.mustchange.${project.replace(/[^a-z0-9]/g, '')}@northkit.test`,
  /** Holds the e2e_viewer role the roles test switches on and off. */
  viewer: (project: string) => `e2e.viewer.${project.replace(/[^a-z0-9]/g, '')}@northkit.test`,
  viewerRole: (project: string) => `e2e_viewer_${project.replace(/[^a-z0-9]/g, '')}`,
} as const;

// Fictional accounts with a fresh random password and two-factor key each run, so no
// secret is ever written down. Tests read them from the environment.
export default async function globalSetup(): Promise<void> {
  await createFreshDatabase(E2E_DB_NAME);
  await createFreshDatabase(SETUP_DB_NAME);
  const password = randomBytes(18).toString('base64url');
  process.env.E2E_PASSWORD = password;
  const hash = await hashPassword(password);
  const pool = createPool('admin', { database: E2E_DB_NAME, max: 1 });
  try {
    const one = async (sql: string, params: unknown[]) =>
      (await pool.query<{ id: string }>(sql, params)).rows[0]!.id;
    await pool.query(
      `INSERT INTO core.organisations (name) VALUES ('Example Building Services Ltd (fictional)')`,
    );
    const siteA = await one(
      `INSERT INTO core.sites (code, name, town) VALUES ('E2E-A', 'Alderbank depot', 'Alderbank') RETURNING id`,
      [],
    );
    const siteB = await one(
      `INSERT INTO core.sites (code, name, town) VALUES ('E2E-B', 'Birchmoor depot', 'Birchmoor') RETURNING id`,
      [],
    );
    // Depot A has a store and two vans; depot B has one van and nothing else, so the
    // overview's figures (and "needs action" for an empty depot, C) are known.
    for (const [site, kind, code, name] of [
      [siteA, 'store', 'A-STORE', 'Main store'],
      [siteA, 'van', 'A-VAN1', 'Van 1'],
      [siteA, 'van', 'A-VAN2', 'Van 2'],
      [siteB, 'van', 'B-VAN1', 'Van 1'],
    ] as const)
      await pool.query(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, $2, $3, $4)`,
        [site, kind, code, name],
      );
    await pool.query(
      `INSERT INTO core.sites (code, name, town) VALUES ('E2E-C', 'Cedarfield depot', 'Cedarfield')`,
    );
    const user = async (
      email: string,
      name: string,
      role: string,
      options: { allSites?: boolean; mfaSecret?: string } = {},
    ) => {
      const id = await one(
        `INSERT INTO core.users (email, display_name, password_hash, all_sites, mfa_secret_encrypted, mfa_enabled_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
        [
          email,
          name,
          hash,
          options.allSites ?? false,
          options.mfaSecret ? sealSecret(options.mfaSecret) : null,
        ],
      );
      await pool.query(
        `INSERT INTO core.user_roles (user_id, role_id) SELECT $1, id FROM core.roles WHERE code = $2`,
        [id, role],
      );
      return id;
    };
    for (const project of PROJECTS) {
      const secret = generateTotpSecret();
      process.env[`E2E_TOTP_${project.replace(/[^a-z0-9]/g, '')}`] = secret;
      await user(E2E.admin(project), `Admin ${project}`, 'admin', {
        allSites: true,
        mfaSecret: secret,
      });
      await user(E2E.newAdmin(project), `New admin ${project}`, 'admin', { allSites: true });
      const mustChange = await user(
        E2E.mustChange(project),
        `Must change ${project}`,
        'supervisor',
      );
      await pool.query(`UPDATE core.users SET must_change_password = true WHERE id = $1`, [
        mustChange,
      ]);
      await pool.query(`INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)`, [
        mustChange,
        siteA,
      ]);
      await pool.query(
        `INSERT INTO core.roles (code, name, permissions) VALUES ($1, $2, '{overview.view}')`,
        [E2E.viewerRole(project), `E2E viewer ${project}`],
      );
      await user(E2E.viewer(project), `Viewer ${project}`, E2E.viewerRole(project), {
        allSites: true,
      });
    }
    const manager = await user(E2E.manager, 'Kit Manager A', 'kit_manager');
    await pool.query(`INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)`, [
      manager,
      siteA,
    ]);
    await pool.query(`UPDATE core.sites SET manager_user_id = $1 WHERE id = $2`, [manager, siteA]);
    const operative = await user(E2E.operative, 'Operative A', 'operative');
    await pool.query(`INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)`, [
      operative,
      siteA,
    ]);
  } finally {
    await pool.end();
  }
}
