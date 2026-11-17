import { createPool, optionalEnv, requireEnv } from '@northkit/db';
import { createFreshDatabase } from '@northkit/db/migrate';
import { hashPassword, passwordProblem } from '../auth/password';
import {
  buildDemoItems,
  checkDemoCompany,
  DEMO_COMPANY_NAME,
  DEMO_LOCATIONS,
  DEMO_SITES,
  DEMO_USERS,
} from '../dev/demo-company';
import { fail, say } from './output';

// pnpm db:seed-demo — development only (S1-10). A made-up contractor, "Fernbrook
// Contracting", with three depots, two vans and a store, cage and yard at each, two job
// sites and nine people, one for each role. Every name, place and figure is invented
// (CLAUDE.md, clean room). The ~600 items are generated and checked here but not stored
// yet: the items table arrives in Sprint 2, which loads them from dev/demo-company.ts.
//
// Rebuilds the database from nothing each run (drop, create, migrate, seed), so it only
// runs on one named northkit_*test* (northkit_demo_test). Everyone signs in with
// SEED_DEMO_PASSWORD; the Administrator then sets up two-factor sign-in as usual.

const pool = createPool('admin', { max: 2 });
try {
  const database = optionalEnv('NORTHKIT_DB_NAME') ?? 'northkit';
  if (!/^northkit_[a-z0-9_]*test[a-z0-9_]*$/.test(database))
    throw new Error(
      `NORTHKIT_DB_NAME is "${database}". The demo seed rebuilds its database from nothing, so it only runs on one named northkit_*test*, such as northkit_demo_test.`,
    );
  const password = requireEnv('SEED_DEMO_PASSWORD');
  const problem = passwordProblem(password, DEMO_USERS[0]!.email);
  if (problem) throw new Error(`SEED_DEMO_PASSWORD: ${problem}`);

  const items = buildDemoItems();
  const problems = checkDemoCompany(items);
  if (problems.length) throw new Error(`The demo company is inconsistent: ${problems[0]}`);

  await createFreshDatabase(database);
  say(`rebuilt ${database} and ran every migration`);

  const hash = await hashPassword(password);
  await pool.query('INSERT INTO core.organisations (name) VALUES ($1)', [DEMO_COMPANY_NAME]);

  const siteIds = new Map<string, string>();
  for (const s of DEMO_SITES) {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO core.sites (code, name, town, postcode) VALUES ($1, $2, $3, $4) RETURNING id',
      [s.code, s.name, s.town, s.postcode],
    );
    siteIds.set(s.code, rows[0]!.id);
  }
  for (const l of DEMO_LOCATIONS)
    await pool.query(
      'INSERT INTO core.locations (site_id, kind, code, name, reference) VALUES ($1, $2, $3, $4, $5)',
      [siteIds.get(l.siteCode), l.kind, l.code, l.name, l.reference],
    );

  for (const u of DEMO_USERS) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO core.users (email, display_name, password_hash, all_sites) VALUES ($1, $2, $3, $4) RETURNING id`,
      [u.email, u.name, hash, u.siteCodes.length === 0],
    );
    const id = rows[0]!.id;
    await pool.query(
      'INSERT INTO core.user_roles (user_id, role_id) SELECT $1, id FROM core.roles WHERE code = $2',
      [id, u.role],
    );
    for (const code of u.siteCodes)
      await pool.query('INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)', [
        id,
        siteIds.get(code),
      ]);
  }

  const vans = DEMO_LOCATIONS.filter((l) => l.kind === 'van').length;
  say(
    `seeded ${DEMO_COMPANY_NAME}: ${DEMO_SITES.length} depots, ${vans} vans, ${DEMO_LOCATIONS.length} locations, ${DEMO_USERS.length} people; ${items.length} items generated and checked (stored from Sprint 2)`,
  );
  say(`sign in as ${DEMO_USERS[0]!.email} with SEED_DEMO_PASSWORD`);
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
