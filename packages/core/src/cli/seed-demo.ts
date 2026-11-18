import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
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
  type DemoItemKind,
} from '../dev/demo-company';
import { filesDir, writeStored } from '../files/storage';
import { demoPhotoId, demoPhotoPng } from '../dev/demo-photos';
import { makeThumbnail } from '../media/thumbnail';
import { fail, say } from './output';

// pnpm db:seed-demo — development only (S1-10). A made-up contractor, "Fernbrook
// Contracting", with three depots, two vans and a store, cage and yard at each, two job
// sites and nine people, one for each role. Every name, place and figure is invented
// (CLAUDE.md, clean room). The ~600 items (generated in dev/demo-company.ts) are stored
// with their kit sets, hired-in and retired items, and placeholder photos drawn in the
// style of the sign-in picture. Running it twice gives the same company: the database is
// rebuilt from nothing and the photo files have fixed names.
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

  const KIND_NAMES: Record<DemoItemKind, string> = {
    power_tool: 'Power tool',
    lifting_gear: 'Lifting gear',
    access_equipment: 'Access equipment',
    ladder: 'Ladder',
    harness: 'Harness',
    pat_item: 'PAT item',
    test_instrument: 'Test instrument',
    plant: 'Plant',
  };
  const kindIds = new Map<string, string>();
  for (const r of (
    await pool.query<{ id: string; name: string }>('SELECT id, name FROM register.kinds')
  ).rows)
    kindIds.set(r.name, r.id);
  const locationIds = new Map<string, string>();
  for (const r of (
    await pool.query<{ id: string; code: string }>('SELECT id, code FROM core.locations')
  ).rows)
    locationIds.set(r.code, r.id);
  await rm(path.join(filesDir(), 'items'), { recursive: true, force: true });
  const itemIds = new Map<string, string>();
  let photos = 0;
  // Kit sets first, so their parts can point at them.
  for (const i of [...items.filter((x) => x.isKit), ...items.filter((x) => !x.isKit)]) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO register.items (site_id, kind_id, asset_number, serial_number, make, model, description, purchase_date,
                                  cost_pence, ownership, hire_company, hire_reference, off_hire_date, location_id,
                                  status, retired_at, retired_reason, is_kit, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [
        siteIds.get(i.siteCode),
        kindIds.get(KIND_NAMES[i.kind]),
        i.tag,
        i.serial,
        i.make,
        i.model,
        i.name,
        i.purchasedOn,
        i.costPence,
        i.ownership,
        i.ownership === 'hired_in' ? 'Example Plant Hire Ltd (fictional)' : null,
        i.ownership === 'hired_in' ? `H-${i.tag.slice(-3)}` : null,
        i.ownership === 'hired_in' ? '2027-03-31' : null,
        locationIds.get(i.locationCode),
        i.retiredReason ? 'retired' : 'available',
        i.retiredReason ? '2026-10-01T09:00:00Z' : null,
        i.retiredReason,
        i.isKit,
        i.kitTag ? itemIds.get(i.kitTag) : null,
      ],
    );
    itemIds.set(i.tag, rows[0]!.id);
    if (i.photo) {
      const png = demoPhotoPng(
        i.tag,
        i.kind === 'ladder' ? 'ladder' : i.kind === 'plant' ? 'plant' : 'other',
      );
      const photoId = demoPhotoId(i.tag);
      const key = `items/${rows[0]!.id}/${photoId}.png`;
      const thumbKey = `items/${rows[0]!.id}/${photoId}.thumb.jpg`;
      await writeStored(key, png);
      await writeStored(thumbKey, makeThumbnail(png));
      await pool.query(
        `INSERT INTO register.item_photos (id, site_id, item_id, content_type, byte_size, width, height, sha256, storage_key, thumb_key)
         VALUES ($1, $2, $3, 'image/png', $4, 480, 320, $5, $6, $7)`,
        [
          photoId,
          siteIds.get(i.siteCode),
          rows[0]!.id,
          png.length,
          createHash('sha256').update(png).digest('hex'),
          key,
          thumbKey,
        ],
      );
      photos += 1;
    }
  }

  const vans = DEMO_LOCATIONS.filter((l) => l.kind === 'van').length;
  say(
    `seeded ${DEMO_COMPANY_NAME}: ${DEMO_SITES.length} depots, ${vans} vans, ${DEMO_LOCATIONS.length} locations, ${DEMO_USERS.length} people; ${items.length} items (${items.filter((x) => x.isKit).length} kit sets, ${items.filter((x) => x.ownership === 'hired_in').length} hired in, ${items.filter((x) => x.retiredReason).length} retired, ${photos} with a placeholder photo)`,
  );
  say(`sign in as ${DEMO_USERS[0]!.email} with SEED_DEMO_PASSWORD`);
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
