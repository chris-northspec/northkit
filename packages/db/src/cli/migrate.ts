import { optionalEnv, requireEnv } from '../config';
import { migrate, setRolePasswords } from '../migrate';
import { createPool } from '../pool';
import { fail, say } from './output';

// pnpm db:migrate — applies every pending migration, then sets the role passwords.
const pool = createPool('admin', { max: 1 });
try {
  const client = await pool.connect();
  try {
    const result = await migrate(client);
    for (const name of result.applied) say(`applied ${name}`);
    say(`${result.applied.length} applied, ${result.alreadyApplied} already up to date`);
    await setRolePasswords(client, {
      app: requireEnv('NORTHKIT_APP_DB_PASSWORD'),
      readonly: optionalEnv('NORTHKIT_READONLY_DB_PASSWORD'),
    });
    say('role passwords set');
  } finally {
    client.release();
  }
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
