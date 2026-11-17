import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDb, createPool } from '@northkit/db';
import { ukDate } from '@northkit/licence';
import { insertLicence } from '../services/licence';
import { fail, say } from './output';

// pnpm licence:install --file /path/to/northkit.licence
// Installs a licence file from the server's terminal: the same check as Settings, for
// when nobody can sign in (for example the only administrator's account is locked).
const pool = createPool('admin', { max: 1 });
try {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('Usage: pnpm licence:install --file /path/to/northkit.licence');
  const payload = await insertLicence(createDb(pool), readFileSync(values.file, 'utf8'), null);
  say(
    `Licence ${payload.licenceRef} for ${payload.licensee} installed (${payload.expiresOn ? `runs to ${ukDate(payload.expiresOn)}` : 'perpetual'}).`,
  );
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
