import { createDb, createPool, optionalEnv, requireEnv } from '@northkit/db';
import { hashPassword, passwordProblem } from '../auth/password';
import { loadActor } from '../auth/sessions';
import { createLocation } from '../services/locations';
import { createSite } from '../services/sites';
import { fail, say } from './output';

// pnpm db:seed — development only. A small fictional set-up so the screens have
// something on them: no real names, companies or addresses (CLAUDE.md, clean room).
// Refuses to run on a database that already has users, and without SEED_ADMIN_PASSWORD.
// The larger fictional company is `pnpm db:seed-demo`.

const SITES = [
  { code: 'NTH1', name: 'Northfield depot', town: 'Northfield', postcode: 'ZZ1 1AA' },
  { code: 'STH2', name: 'Southmoor depot', town: 'Southmoor', postcode: 'ZZ2 2BB' },
  { code: 'EST3', name: 'Eastbrook depot', town: 'Eastbrook', postcode: 'ZZ3 3CC' },
];

const pool = createPool('admin', { max: 2 });
const db = createDb(pool);
try {
  const email = optionalEnv('SEED_ADMIN_EMAIL') ?? 'admin@northkit.test';
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`SEED_ADMIN_PASSWORD: ${problem}`);
  const existing = await db.selectFrom('core.users').select('id').limit(1).executeTakeFirst();
  if (existing)
    throw new Error('The database already has users. Seed only an empty development database.');

  const hash = await hashPassword(password);
  const adminId = await db.transaction().execute(async (tx) => {
    const { id } = await tx
      .insertInto('core.users')
      .values({ email, display_name: 'Demo Administrator', password_hash: hash, all_sites: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    const role = await tx
      .selectFrom('core.roles')
      .select('id')
      .where('code', '=', 'admin')
      .executeTakeFirstOrThrow();
    await tx.insertInto('core.user_roles').values({ user_id: id, role_id: role.id }).execute();
    await tx
      .insertInto('core.organisations')
      .values({ name: 'Example Building Services Ltd (fictional)' })
      .execute();
    return id;
  });

  // The seed acts as the administrator through the services, so everything is audited.
  let actor = await db.transaction().execute((tx) => loadActor(tx, adminId, { allSites: true }));
  for (const s of SITES) {
    const site = await createSite(db, actor, s);
    actor = { ...actor, siteIds: [...actor.siteIds, site.id] };
    await createLocation(db, actor, site.id, {
      code: `${s.code}-STORE`,
      name: 'Main store',
      kind: 'store',
    });
    await createLocation(db, actor, site.id, {
      code: `${s.code}-YARD`,
      name: 'Yard',
      kind: 'yard',
    });
    await createLocation(db, actor, site.id, {
      code: `${s.code}-VAN1`,
      name: 'Van 1',
      kind: 'van',
    });
    say(`seeded ${site.code} ${site.name}`);
  }
  say(`Administrator ${email} created; you will be asked to set up two-factor sign-in.`);
} catch (error) {
  fail(error);
} finally {
  await db.destroy();
}
