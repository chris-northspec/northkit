import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createPool } from '@northkit/db';
import { hashPassword, passwordProblem } from '../auth/password';
import { fail, say } from './output';

// pnpm admin:create --email you@example.com --name "Your Name"
// Copied from NorthCore WMS. The fallback to the first-run screen: a fresh install has
// no accounts and no default password; this makes an administrator from the server's
// terminal. The password is read without echo (or from stdin when piped) so it never
// appears in shell history.
async function readPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    const rl = createInterface({ input });
    for await (const line of rl) return line;
    return '';
  }
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    input.on('data', onData);
  });
}

const pool = createPool('admin', { max: 1 });
try {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  if (!values.email || !values.name) {
    throw new Error('Usage: pnpm admin:create --email you@example.com --name "Your Name"');
  }
  const password = await readPassword('Password (at least 12 characters): ');
  const problem = passwordProblem(password, values.email);
  if (problem) throw new Error(problem);
  if (process.stdin.isTTY && (await readPassword('Same password again: ')) !== password) {
    throw new Error('The passwords don’t match.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core.users (email, display_name, password_hash, all_sites)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [values.email.trim().toLowerCase(), values.name.trim(), await hashPassword(password)],
    );
    await client.query(
      `INSERT INTO core.user_roles (user_id, role_id) SELECT $1, id FROM core.roles WHERE code = 'admin'`,
      [rows[0]!.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') {
      throw new Error('A user with that email already exists.', { cause: error });
    }
    throw error;
  } finally {
    client.release();
  }
  say(
    `Administrator ${values.email} created. They will be asked to turn on two-factor sign-in when they first sign in.`,
  );
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
