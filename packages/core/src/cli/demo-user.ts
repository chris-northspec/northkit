import { connectionSettings, createPool, optionalEnv } from '@northkit/db';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { fail, say } from './output';

// pnpm demo:user (docs/demo-link.md): the one sign-in Chris uses on every NorthSpec demo
// link. Creates or updates an Administrator demo@northspec.test whose password is
// DEMO_SHARED_PASSWORD from deploy/.env (git-ignored). Runs only against a database
// whose name says it is a demo or development one (such as northkit_demo_test, the
// fictional demo estate), never a customer's. The password is hashed with Argon2id as
// every other password is, and is never printed. Two-factor stays as the Administrator
// role requires: set it up on first sign-in. Re-running it with a new password changes it
// and signs the demo user out everywhere. With --check (used by `pnpm demo`) a demo user
// whose password already matches is left alone, so starting the demo signs nobody out.

const EMAIL = 'demo@northspec.test';
const NAME = 'NorthSpec demo';
const DEMO_DB = /^northkit_[a-z0-9_]*(demo|dev)[a-z0-9_]*$/;

const database = connectionSettings('admin').database;
if (!DEMO_DB.test(database))
  fail(
    `NORTHKIT_DB_NAME is "${database}". The demo user is only made on a demo or development database (a name like northkit_demo_test), never a customer's.`,
  );
const password = optionalEnv('DEMO_SHARED_PASSWORD') ?? '';
if (password.length < 12)
  fail('Set DEMO_SHARED_PASSWORD in deploy/.env (at least 12 characters) and run it again.');
const problem = passwordProblem(password, EMAIL);
if (problem) fail(`DEMO_SHARED_PASSWORD: ${problem}`);

const pool = createPool('admin', { max: 1 });
const client = await pool.connect();
try {
  if (process.argv.includes('--check')) {
    const { rows } = await client.query<{ password_hash: string | null; archived_at: Date | null }>(
      'SELECT password_hash, archived_at FROM core.users WHERE lower(email) = $1',
      [EMAIL],
    );
    const current = rows[0];
    if (
      current?.password_hash &&
      !current.archived_at &&
      (await verifyPassword(current.password_hash, password))
    ) {
      say(`the Administrator ${EMAIL} on ${database} is already set up; left alone`);
      client.release();
      await pool.end();
      process.exit(0);
    }
  }
  await client.query('BEGIN');
  const hash = await hashPassword(password);
  const { rows } = await client.query<{ id: string; created: boolean }>(
    `INSERT INTO core.users (email, display_name, password_hash, all_sites)
     VALUES ($1, $2, $3, true)
     ON CONFLICT ((lower(email))) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, archived_at = NULL, all_sites = true,
           must_change_password = false, failed_login_count = 0, locked_until = NULL
     RETURNING id, (xmax = 0) AS created`,
    [EMAIL, NAME, hash],
  );
  const { id, created } = rows[0]!;
  await client.query(
    `INSERT INTO core.user_roles (user_id, role_id)
     SELECT $1, r.id FROM core.roles r WHERE r.code = 'admin'
        AND NOT EXISTS (SELECT FROM core.user_roles ur WHERE ur.user_id = $1 AND ur.role_id = r.id)`,
    [id],
  );
  // A changed password ends any session made with the old one.
  if (!created) await client.query('DELETE FROM core.sessions WHERE user_id = $1', [id]);
  await client.query('COMMIT');
  say(
    `${created ? 'made' : 'updated'} the Administrator ${EMAIL} on ${database}; two-factor is set up on first sign-in`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
