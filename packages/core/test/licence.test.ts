import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payload, signLicence, testKey } from '../../licence/test/sign';
import { ForbiddenError, ValidationError } from '../src/errors';
import { PRODUCT_VERSION } from '../src/product';
import { currentLicence, installLicence } from '../src/services/licence';
import { createLocation, listLocations } from '../src/services/locations';
import { changeOwnPassword } from '../src/services/users';
import { fixtures, PASSWORD, type Fixtures } from './fixtures';

// S1-7: licence installed in the database, verified offline, and a lapsed licence
// makes every scoped transaction READ ONLY, so PostgreSQL itself refuses writes while
// everything stays readable. People can still sign in and manage their own account.

let f: Fixtures;
const key = testKey();
const keys = { [key.keyId]: key.publicKey };

beforeAll(() => {
  f = fixtures();
});
afterAll(async () => {
  // Licences installed here would put every other test file's sessions in read-only.
  await f.admin.query('DELETE FROM core.licences');
  await f.close();
});

describe('licence in the product (S1-7)', () => {
  it('keeps the product version in step with package.json', () => {
    const root = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(PRODUCT_VERSION).toBe(root.version);
  });

  it('only an administrator installs a licence, and it must verify', async () => {
    const hof = await f.user({ roles: ['kit_manager'], allSites: true });
    const adminUser = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    const text = signLicence(key, payload({ licenceRef: `NK-${f.tag}`, expiresOn: '2099-12-31' }));
    await expect(
      installLicence(f.db, await f.actor(hof.id), text, { trustedKeys: keys }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      installLicence(f.db, await f.actor(adminUser.id), text, { trustedKeys: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await installLicence(f.db, await f.actor(adminUser.id), text, { trustedKeys: keys });
    const status = await currentLicence(f.db, { trustedKeys: keys });
    expect(status).toMatchObject({
      state: 'valid',
      readOnly: false,
      payload: { licenceRef: `NK-${f.tag}` },
    });
    // The same file against the built-in keys (none yet) is not trusted: read-only, not dark.
    expect((await currentLicence(f.db)).state).toBe('invalid');
  });

  it('a renewal is just a newer file; a lapsed one reads as lapsed', async () => {
    const adminUser = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    const old = signLicence(
      key,
      payload({ licenceRef: `OLD-${f.tag}`, issuedOn: '2019-02-01', expiresOn: '2020-01-31' }),
    );
    await installLicence(f.db, await f.actor(adminUser.id), old, { trustedKeys: keys });
    expect(await currentLicence(f.db, { trustedKeys: keys })).toMatchObject({
      state: 'lapsed',
      readOnly: true,
    });
    const renewed = signLicence(
      key,
      payload({ licenceRef: `NEW-${f.tag}`, expiresOn: '2099-12-31' }),
    );
    await installLicence(f.db, await f.actor(adminUser.id), renewed, { trustedKeys: keys });
    expect(await currentLicence(f.db, { trustedKeys: keys })).toMatchObject({ state: 'valid' });
    const { rows } = await f.admin.query('SELECT count(*)::int AS n FROM core.licences');
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('read-only: the database refuses writes, reads still work', async () => {
    const site = await f.site();
    const user = await f.user({ roles: ['kit_manager'], siteIds: [site] });
    const readOnly = await f.actor(user.id, { readOnly: true });
    await expect(
      createLocation(f.db, readOnly, site, { code: 'RO1', name: 'Blocked', kind: 'store' }),
    ).rejects.toMatchObject({ code: '25006' });
    expect(await listLocations(f.db, readOnly, site)).toEqual([]);
    // Securing your own account is never blocked.
    await changeOwnPassword(f.db, user.id, PASSWORD, 'a brand new long password');
    const writable = await f.actor(user.id);
    await createLocation(f.db, writable, site, { code: 'RW1', name: 'Allowed', kind: 'store' });
  });

  it('the licence table can only be added to', async () => {
    await expect(
      f.db.updateTable('core.licences').set({ licensee: 'Changed' }).execute(),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(f.db.deleteFrom('core.licences').execute()).rejects.toMatchObject({
      code: '42501',
    });
  });
});
