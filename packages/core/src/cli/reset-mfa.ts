import { parseArgs } from 'node:util';
import { createPool } from '@northkit/db';
import { fail, say } from './output';

// pnpm admin:reset-mfa --email someone@example.com
// Turns two-factor sign-in off for a user who has lost their phone and key, and ends
// their sessions. The fallback when no administrator can sign in to do it on screen.
const pool = createPool('admin', { max: 1 });
try {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  if (!values.email) throw new Error('Usage: pnpm admin:reset-mfa --email someone@example.com');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `UPDATE core.users
          SET mfa_enabled_at = NULL, mfa_secret_encrypted = NULL, mfa_last_used_step = NULL
        WHERE lower(email) = lower($1) AND archived_at IS NULL
        RETURNING id`,
      [values.email.trim()],
    );
    const user = rows[0];
    if (!user) throw new Error('No live user has that email.');
    await client.query(
      `UPDATE core.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO audit.audit_events (action, entity_type, entity_id, after)
       VALUES ('auth.mfa_reset', 'core.users', $1, '{"reset_by": "pnpm admin:reset-mfa"}')`,
      [user.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  say(`Two-factor sign-in is off for ${values.email}. They can sign in and set it up again.`);
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
