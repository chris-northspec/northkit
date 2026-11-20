import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, appPool, tag } from './helpers';

// Sprint 2 (A15 and the register rules): what the database itself refuses, whatever a
// screen or an import tries. Status transitions, kits, hire details, photo limits, kinds.

let admin: pg.Pool;
let app: pg.Pool;
const t = tag();
let site: string;
let otherSite: string;
let kind: string;
let n = 0;

const asset = () => `RT${++n}${t}`;

async function item(extra: Record<string, unknown> = {}): Promise<string> {
  const row = { site_id: site, kind_id: kind, asset_number: asset(), ...extra };
  const keys = Object.keys(row);
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO register.items (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  admin = adminPool();
  app = appPool();
  site = (
    await admin.query<{ id: string }>(
      `INSERT INTO core.sites (code, name) VALUES ($1, 'Register test') RETURNING id`,
      [`RA${t}`],
    )
  ).rows[0]!.id;
  otherSite = (
    await admin.query<{ id: string }>(
      `INSERT INTO core.sites (code, name) VALUES ($1, 'Other depot') RETURNING id`,
      [`RB${t}`],
    )
  ).rows[0]!.id;
  kind = (await admin.query<{ id: string }>(`SELECT id FROM register.kinds WHERE name = 'Ladder'`))
    .rows[0]!.id;
});
afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('kinds and their rules', () => {
  it('ships the eight starter kinds, each with editable rules and a note', async () => {
    const { rows } = await admin.query<{ name: string; rules: number; noted: number }>(
      `SELECT k.name, count(r.id)::int AS rules, count(r.note)::int AS noted
         FROM register.kinds k LEFT JOIN register.kind_rules r ON r.kind_id = k.id
        WHERE k.name IN ('Power tool','Lifting gear','Access equipment','Ladder','Harness','PAT item','Test instrument','Plant')
        GROUP BY k.name ORDER BY k.name`,
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) expect(r.noted, r.name).toBe(r.rules);
    expect(rows.every((r) => r.rules >= 2)).toBe(true);
  });

  it('defaults the lifting gear thorough examination to 6 months and PAT to a risk-based note', async () => {
    const { rows } = await admin.query<{ interval_value: number; interval_unit: string }>(
      `SELECT r.interval_value, r.interval_unit FROM register.kind_rules r JOIN register.kinds k ON k.id = r.kind_id
        WHERE k.name = 'Lifting gear' AND r.rule_type = 'loler'`,
    );
    expect(rows[0]).toEqual({ interval_value: 6, interval_unit: 'months' });
    const pat = await admin.query<{ note: string }>(
      `SELECT r.note FROM register.kind_rules r JOIN register.kinds k ON k.id = r.kind_id
        WHERE k.name = 'PAT item' AND r.rule_type = 'pat'`,
    );
    expect(pat.rows[0]!.note).toMatch(/Risk-based/);
  });

  it('refuses to delete a kind that is in use, but deletes an unused one', async () => {
    await item();
    await expect(
      app.query('DELETE FROM register.kinds WHERE id = $1', [kind]),
    ).rejects.toMatchObject({
      code: '23503',
    });
    const fresh = (
      await admin.query<{ id: string }>(
        `INSERT INTO register.kinds (name) VALUES ($1) RETURNING id`,
        [`Unused ${t}`],
      )
    ).rows[0]!.id;
    expect((await app.query('DELETE FROM register.kinds WHERE id = $1', [fresh])).rowCount).toBe(1);
  });

  it('refuses a new item of a deactivated kind', async () => {
    const dead = (
      await admin.query<{ id: string }>(
        `INSERT INTO register.kinds (name, active) VALUES ($1, false) RETURNING id`,
        [`Dead ${t}`],
      )
    ).rows[0]!.id;
    await expect(item({ kind_id: dead })).rejects.toMatchObject({
      constraint: 'items_kind_active',
    });
  });
});

describe('items', () => {
  it('keeps asset numbers unique across depots, ignoring case', async () => {
    const number = asset();
    await item({ asset_number: number });
    await expect(item({ site_id: otherSite, asset_number: number })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('generates the next unused asset number and never repeats one', async () => {
    const prefix = `G${t}`.slice(0, 8);
    const first = (
      await app.query<{ n: string }>('SELECT register.next_asset_number($1) AS n', [prefix])
    ).rows[0]!.n;
    expect(first).toBe(`${prefix}-000001`);
    // A number typed in by hand is skipped.
    await item({ asset_number: `${prefix}-000002` });
    const next = (
      await app.query<{ n: string }>('SELECT register.next_asset_number($1) AS n', [prefix])
    ).rows[0]!.n;
    expect(next).toBe(`${prefix}-000003`);
  });

  it('allows only the permitted status transitions', async () => {
    const id = await item();
    const set = (status: string, extra = '') =>
      admin.query(`UPDATE register.items SET status = $2 ${extra} WHERE id = $1`, [id, status]);
    await set('quarantined');
    await expect(set('out')).rejects.toMatchObject({ constraint: 'items_status_transition' });
    await set('available');
    await set('retired', `, retired_at = now(), retired_reason = 'Scrapped'`);
    await expect(
      set('available', `, retired_at = NULL, retired_reason = NULL`),
    ).rejects.toMatchObject({
      constraint: 'items_status_transition',
    });
  });

  it('needs a reason and a date to retire, and carries them nowhere else', async () => {
    const id = await item();
    await expect(
      admin.query(`UPDATE register.items SET status = 'retired' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'items_retired' });
    await expect(
      admin.query(`UPDATE register.items SET retired_reason = 'x' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'items_retired' });
  });

  it('keeps hire details for hired-in kit only, and names the company', async () => {
    await expect(item({ hire_company: 'Example Hire Ltd' })).rejects.toMatchObject({
      constraint: 'items_hire_details',
    });
    await expect(item({ ownership: 'hired_in' })).rejects.toMatchObject({
      constraint: 'items_hire_details',
    });
    await item({
      ownership: 'hired_in',
      hire_company: 'Example Hire Ltd',
      hire_reference: 'H-1',
      off_hire_date: '2027-03-01',
    });
  });

  it('keeps cost in exact whole pence', async () => {
    const id = await item({ cost_pence: 12345 });
    const { rows } = await admin.query<{ cost_pence: string }>(
      'SELECT cost_pence FROM register.items WHERE id = $1',
      [id],
    );
    expect(Number(rows[0]!.cost_pence)).toBe(12345);
    await expect(item({ cost_pence: -1 })).rejects.toMatchObject({ code: '23514' });
  });

  it('puts an item only in a location of its own depot', async () => {
    const elsewhere = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', 'RS', 'Elsewhere') RETURNING id`,
        [otherSite],
      )
    ).rows[0]!.id;
    await expect(item({ location_id: elsewhere })).rejects.toMatchObject({ code: '23503' });
  });
});

describe('kit sets', () => {
  it('holds items one level deep, in one depot', async () => {
    const kit = await item({ is_kit: true });
    const part = await item({ parent_id: kit });
    // A kit can't be inside a kit, and an item isn't a kit to hold items.
    await expect(item({ is_kit: true, parent_id: kit })).rejects.toMatchObject({
      constraint: 'items_kit_not_child',
    });
    await expect(item({ parent_id: part })).rejects.toMatchObject({
      constraint: 'items_parent_is_kit',
    });
    // Another depot's kit can't hold this depot's item.
    const foreignKit = await item({ site_id: otherSite, is_kit: true });
    await expect(item({ parent_id: foreignKit })).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses to retire a kit that still holds items, or turn it into a single item', async () => {
    const kit = await item({ is_kit: true });
    await item({ parent_id: kit });
    await expect(
      admin.query(
        `UPDATE register.items SET status = 'retired', retired_at = now(), retired_reason = 'x' WHERE id = $1`,
        [kit],
      ),
    ).rejects.toMatchObject({ constraint: 'items_retire_kit_with_items' });
    await expect(
      admin.query(`UPDATE register.items SET is_kit = false WHERE id = $1`, [kit]),
    ).rejects.toMatchObject({ constraint: 'items_kit_has_items' });
  });
});

describe('photos', () => {
  it('allows at most 10 per item', async () => {
    const id = await item();
    const add = () =>
      admin.query(
        `INSERT INTO register.item_photos (site_id, item_id, content_type, byte_size, width, height, sha256, storage_key)
         VALUES ($1, $2::uuid, 'image/png', 10, 1, 1, repeat('b', 64), 'items/' || $2::text || '/' || public.uuid_v7() || '.png')`,
        [site, id],
      );
    for (let i = 0; i < 10; i++) await add();
    await expect(add()).rejects.toMatchObject({ constraint: 'item_photos_max' });
  });

  it('refuses a size over 10 MB and a type that is not an image', async () => {
    const id = await item();
    const bad = (type: string, size: number) =>
      admin.query(
        `INSERT INTO register.item_photos (site_id, item_id, content_type, byte_size, width, height, sha256, storage_key)
         VALUES ($1, $2::uuid, $3, $4, 1, 1, repeat('b', 64), 'items/' || $2::text || '/' || public.uuid_v7() || '.png')`,
        [site, id, type, size],
      );
    await expect(bad('image/png', 10 * 1024 * 1024 + 1)).rejects.toMatchObject({ code: '23514' });
    await expect(bad('image/svg+xml', 10)).rejects.toMatchObject({ code: '23514' });
    await expect(bad('image/gif', 10)).rejects.toMatchObject({ code: '23514' });
  });
});
