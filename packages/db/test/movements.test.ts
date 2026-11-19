import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, appPool, tag } from './helpers';

// Sprint 3 (A10, A16, A17, A18): what the database itself enforces about where kit is.
// Every attempt that must fail is made as northkit_app, the role the app uses, scoped to a
// depot as the app scopes it. The movement record is evidence; the item's position, status
// and holder change only by inserting one (migration 0006).

let admin: pg.Pool;
let app: pg.Pool;
const t = tag();
let siteA: string;
let siteB: string;
let siteC: string;
let kind: string;
let userA: string;
let userB: string;
let storeA: string;
let vanA: string;
let jobA: string;
let storeB: string;
let n = 0;

const asset = () => `MV${++n}${t}`;

async function item(site = siteA, extra: Record<string, unknown> = {}): Promise<string> {
  const row = { site_id: site, kind_id: kind, asset_number: asset(), location_id: null, ...extra };
  const keys = Object.keys(row);
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO register.items (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

/** Runs `fn` as northkit_app in a committed transaction scoped like the app scopes one. */
async function asApp<T>(
  sites: string[],
  user: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.site_ids', $1, true), set_config('app.user_id', $2, true)",
      [`{${sites.join(',')}}`, user],
    );
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

interface MoveInput {
  site?: string;
  item: string;
  type: string;
  toUser?: string | null;
  toLocation?: string | null;
  due?: string | null;
  note?: string | null;
  transfer?: string | null;
  id?: string;
  occurredAt?: string;
}

async function move(c: pg.PoolClient, m: MoveInput) {
  return c.query(
    `INSERT INTO movements.movements (id, site_id, item_id, movement_type, to_user_id, to_location_id, due_back_on, note, transfer_id, occurred_at)
     VALUES (coalesce($1::uuid, public.uuid_v7()), $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now())) RETURNING id`,
    [
      m.id ?? null,
      m.site ?? siteA,
      m.item,
      m.type,
      m.toUser ?? null,
      m.toLocation ?? null,
      m.due ?? null,
      m.note ?? null,
      m.transfer ?? null,
      m.occurredAt ?? null,
    ],
  );
}

const moveA = (m: MoveInput, user = userA) => asApp([siteA], user, (c) => move(c, m));

async function state(id: string) {
  const { rows } = await admin.query<{
    status: string;
    holder_user_id: string | null;
    location_id: string | null;
    due_back_on: string | null;
    overdue_at: Date | null;
    site_id: string;
  }>(
    `SELECT status, holder_user_id, location_id, to_char(due_back_on, 'YYYY-MM-DD') AS due_back_on, overdue_at, site_id
       FROM register.items WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  admin = adminPool();
  app = appPool();
  const site = async (code: string, tz = 'Europe/London') =>
    (
      await admin.query<{ id: string }>(
        `INSERT INTO core.sites (code, name, time_zone) VALUES ($1, $2, $3) RETURNING id`,
        [`${code}${t}`, `Depot ${code}`, tz],
      )
    ).rows[0]!.id;
  siteA = await site('MA');
  siteB = await site('MB');
  siteC = await site('MC');
  const loc = async (s: string, kindName: string, code: string) =>
    (
      await admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, $2, $3, $3) RETURNING id`,
        [s, kindName, code],
      )
    ).rows[0]!.id;
  storeA = await loc(siteA, 'store', 'STORE');
  vanA = await loc(siteA, 'van', 'VAN1');
  jobA = await loc(siteA, 'site', 'JOB1');
  storeB = await loc(siteB, 'store', 'STORE');
  kind = (await admin.query<{ id: string }>('SELECT id FROM register.kinds ORDER BY name LIMIT 1'))
    .rows[0]!.id;
  const user = async (name: string) =>
    (
      await admin.query<{ id: string }>(
        `INSERT INTO core.users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`${name}.${t.toLowerCase()}@northkit.test`, name],
      )
    ).rows[0]!.id;
  userA = await user('mover-a');
  userB = await user('mover-b');
});

afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('the movement record is evidence', () => {
  it('can never be updated or deleted, by the app or the owner', async () => {
    const id = await item();
    const { rows } = await moveA({ item: id, type: 'check_out', toUser: userA });
    const movementId = rows[0].id;
    await expect(
      asApp([siteA], userA, (c) =>
        c.query(`UPDATE movements.movements SET note = 'x' WHERE id = $1`, [movementId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asApp([siteA], userA, (c) =>
        c.query(`DELETE FROM movements.movements WHERE id = $1`, [movementId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // The superuser is stopped by the trigger, not just by grants.
    await expect(
      admin.query(`UPDATE movements.movements SET note = 'x' WHERE id = $1`, [movementId]),
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('record a new one'),
    });
    await expect(
      admin.query(`DELETE FROM movements.movements WHERE id = $1`, [movementId]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('records who, when, from and to, with from taken from the item and never typed', async () => {
    const id = await item(siteA, { location_id: storeA });
    const before = await state(id);
    expect(before.location_id).toBe(storeA);
    await moveA({ item: id, type: 'check_out', toUser: userB, note: 'For the Smith job' });
    const { rows } = await admin.query(
      `SELECT from_location_id, from_user_id, to_user_id, created_by, note FROM movements.movements WHERE item_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        from_location_id: storeA,
        from_user_id: null,
        to_user_id: userB,
        created_by: userA,
        note: 'For the Smith job',
      },
    ]);
  });

  it('recognises a phone replaying the same movement (same id): the second is refused', async () => {
    const id = await item();
    const movementId = randomUUID();
    const when = new Date(Date.now() - 3600_000).toISOString();
    await moveA({ item: id, type: 'check_out', toUser: userA, id: movementId, occurredAt: when });
    await expect(
      moveA({ item: id, type: 'check_out', toUser: userA, id: movementId, occurredAt: when }),
    ).rejects.toBeDefined();
    const { rows } = await admin.query('SELECT 1 FROM movements.movements WHERE id = $1', [
      movementId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('puts a movement from months ago in its own month, and refuses one from the future', async () => {
    const id = await item();
    const old = new Date(Date.now() - 80 * 86_400_000).toISOString();
    await moveA({ item: id, type: 'check_out', toUser: userA, occurredAt: old });
    const { rows } = await admin.query<{ part: string }>(
      `SELECT tableoid::regclass::text AS part FROM movements.movements WHERE item_id = $1`,
      [id],
    );
    expect(rows[0]!.part).toMatch(/^movements\.movements_y\d{4}m\d{2}$/);
    const id2 = await item();
    await expect(
      moveA({
        item: id2,
        type: 'check_out',
        toUser: userA,
        occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).rejects.toMatchObject({ constraint: 'movements_not_future' });
  });
});

describe('only an available item can be checked out', () => {
  it('goes out to a person, with a due-back date and the moment it becomes overdue', async () => {
    const id = await item(siteA, { location_id: storeA });
    await moveA({ item: id, type: 'check_out', toUser: userA, due: future(3) });
    const s = await state(id);
    expect(s).toMatchObject({
      status: 'out',
      holder_user_id: userA,
      location_id: null,
      due_back_on: future(3),
    });
    // Overdue from the start of the day after the due date, in the depot's own time zone.
    expect(s.overdue_at!.getTime()).toBeGreaterThan(Date.now() + 3 * 86_400_000);
    expect(s.overdue_at!.getTime()).toBeLessThan(Date.now() + 5 * 86_400_000);
  });

  it('goes out to a van or a job site; to a store it is moved and stays available', async () => {
    const a = await item(siteA, { location_id: storeA });
    await moveA({ item: a, type: 'check_out', toLocation: vanA });
    expect(await state(a)).toMatchObject({
      status: 'out',
      location_id: vanA,
      holder_user_id: null,
    });
    const b = await item(siteA, { location_id: storeA });
    await moveA({ item: b, type: 'check_out', toLocation: jobA });
    expect(await state(b)).toMatchObject({ status: 'out', location_id: jobA });
    const c = await item(siteA, { location_id: vanA });
    const stock = (
      await admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', 'CAGE' || $2, 'Cage') RETURNING id`,
        [siteA, String(n)],
      )
    ).rows[0]!.id;
    await moveA({ item: c, type: 'check_out', toLocation: stock });
    expect(await state(c)).toMatchObject({ status: 'available', location_id: stock });
    await expect(
      moveA({
        item: await item(siteA, { location_id: vanA }),
        type: 'check_out',
        toLocation: stock,
        due: future(2),
      }),
    ).rejects.toMatchObject({ constraint: 'movements_due_back_place' });
  });

  it.each([
    ['out', 'is already out'],
    [
      'quarantined',
      'is quarantined and can’t be checked out until a passed inspection is recorded',
    ],
    ['missing', 'is reported missing'],
  ])('refuses a %s item, and says why', async (status, why) => {
    const id = await item();
    if (status === 'out') await moveA({ item: id, type: 'check_out', toUser: userA });
    else if (status === 'missing') await moveA({ item: id, type: 'missing' });
    else await admin.query(`UPDATE register.items SET status = 'quarantined' WHERE id = $1`, [id]);
    await expect(moveA({ item: id, type: 'check_out', toUser: userB })).rejects.toMatchObject({
      constraint: 'movements_check_out_available',
      message: expect.stringContaining(why.replace('’', "'")),
    });
    expect((await state(id)).status).toBe(status);
  });

  it('refuses a retired item', async () => {
    const id = await item();
    await admin.query(
      `UPDATE register.items SET status = 'retired', retired_at = now(), retired_reason = 'Scrapped' WHERE id = $1`,
      [id],
    );
    await expect(moveA({ item: id, type: 'check_out', toUser: userA })).rejects.toMatchObject({
      message: expect.stringContaining('retired'),
    });
  });

  it('needs exactly one destination, and a due date that is not in the past', async () => {
    const id = await item();
    await expect(moveA({ item: id, type: 'check_out' })).rejects.toMatchObject({
      constraint: 'movements_needs_destination',
    });
    await expect(
      moveA({ item: id, type: 'check_out', toUser: userA, due: '2020-01-01' }),
    ).rejects.toMatchObject({ constraint: 'movements_due_back_past' });
    await expect(
      admin.query(
        `INSERT INTO movements.movements (site_id, item_id, movement_type, to_user_id, to_location_id)
         VALUES ($1, $2, 'check_out', $3, $4)`,
        [siteA, id, userA, vanA],
      ),
    ).rejects.toMatchObject({ constraint: 'movements_needs_destination' });
  });

  it('is checked out once, even by two phones at the same moment', async () => {
    const id = await item();
    const results = await Promise.allSettled([
      moveA({ item: id, type: 'check_out', toUser: userA }),
      moveA({ item: id, type: 'check_out', toUser: userB }, userB),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const { rows } = await admin.query('SELECT 1 FROM movements.movements WHERE item_id = $1', [
      id,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('check-in', () => {
  it('returns an out item to a place and clears who has it', async () => {
    const id = await item(siteA, { location_id: storeA });
    await moveA({ item: id, type: 'check_out', toUser: userA, due: future(1) });
    await moveA({ item: id, type: 'check_in', toLocation: storeA, note: 'Chuck slightly loose' });
    expect(await state(id)).toMatchObject({
      status: 'available',
      holder_user_id: null,
      location_id: storeA,
      due_back_on: null,
      overdue_at: null,
    });
    const { rows } = await admin.query(
      `SELECT from_user_id, note FROM movements.movements WHERE item_id = $1 AND movement_type = 'check_in'`,
      [id],
    );
    expect(rows[0]).toEqual({ from_user_id: userA, note: 'Chuck slightly loose' });
  });

  it('refuses an item that is not out, and needs a place', async () => {
    const id = await item(siteA, { location_id: storeA });
    await expect(moveA({ item: id, type: 'check_in', toLocation: storeA })).rejects.toMatchObject({
      constraint: 'movements_check_in_out',
    });
    await moveA({ item: id, type: 'check_out', toUser: userA });
    await expect(moveA({ item: id, type: 'check_in' })).rejects.toMatchObject({
      constraint: 'movements_needs_destination',
    });
    await expect(moveA({ item: id, type: 'check_in', toUser: userB })).rejects.toMatchObject({
      constraint: 'movements_needs_destination',
    });
  });
});

describe('the current position can’t drift from the movements', () => {
  it('refuses a direct change to where an item is, as the app and as the owner', async () => {
    const id = await item(siteA, { location_id: storeA });
    for (const set of [
      `location_id = '${vanA}'`,
      `holder_user_id = '${userA}'`,
      `status = 'out'`,
      `status = 'missing'`,
      `due_back_on = current_date`,
      `site_id = '${siteB}'`,
    ]) {
      await expect(
        asApp([siteA], userA, (c) =>
          c.query(`UPDATE register.items SET ${set} WHERE id = $1`, [id]),
        ),
        set,
      ).rejects.toMatchObject({
        constraint: expect.stringMatching(/items_whereabouts_by_movement|items_/),
      });
      await expect(
        admin.query(`UPDATE register.items SET ${set} WHERE id = $1`, [id]),
        set,
      ).rejects.toBeDefined();
    }
    expect(await state(id)).toMatchObject({ status: 'available', location_id: storeA });
    // Other edits are fine.
    await asApp([siteA], userA, (c) =>
      c.query(`UPDATE register.items SET notes = 'ok' WHERE id = $1`, [id]),
    );
  });

  it('after any run of movements the item matches the last one', async () => {
    const id = await item(siteA, { location_id: storeA });
    const steps: MoveInput[] = [
      { item: id, type: 'check_out', toUser: userA, due: future(2) },
      { item: id, type: 'check_in', toLocation: storeA },
      { item: id, type: 'check_out', toLocation: vanA },
      { item: id, type: 'move', toLocation: jobA },
      { item: id, type: 'missing' },
      { item: id, type: 'found', toLocation: storeA },
      { item: id, type: 'check_out', toUser: userB },
      { item: id, type: 'check_in', toLocation: vanA },
    ];
    for (const step of steps) {
      await moveA(step);
      const { rows } = await admin.query<{
        movement_type: string;
        to_user_id: string | null;
        to_location_id: string | null;
      }>(
        `SELECT movement_type, to_user_id, to_location_id FROM movements.movements WHERE item_id = $1
          ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
        [id],
      );
      const last = rows[0]!;
      const s = await state(id);
      expect(s.holder_user_id).toBe(last.to_user_id);
      expect(s.location_id).toBe(last.to_location_id);
      expect(s.status).toBe(
        last.movement_type === 'missing'
          ? 'missing'
          : last.to_user_id ||
              ['van', 'site'].includes(
                last.to_location_id === vanA
                  ? 'van'
                  : last.to_location_id === jobA
                    ? 'site'
                    : 'store',
              )
            ? last.movement_type === 'check_in'
              ? 'available'
              : 'out'
            : 'available',
      );
    }
  });
});

describe('kit sets move together', () => {
  async function kitWithParts(parts = 2) {
    const kit = await item(siteA, { is_kit: true, location_id: storeA });
    const ids: string[] = [];
    for (let i = 0; i < parts; i++)
      ids.push(await item(siteA, { parent_id: kit, location_id: storeA }));
    return { kit, ids };
  }

  it('checks the parts out and in with the kit, in the same transaction', async () => {
    const { kit, ids } = await kitWithParts();
    await moveA({ item: kit, type: 'check_out', toUser: userA, due: future(2) });
    for (const id of [kit, ...ids])
      expect(await state(id)).toMatchObject({
        status: 'out',
        holder_user_id: userA,
        due_back_on: future(2),
      });
    const { rows } = await admin.query(
      `SELECT item_id, via_kit_id FROM movements.movements WHERE item_id = ANY($1) AND movement_type = 'check_out'`,
      [ids],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.via_kit_id === kit)).toBe(true);
    await moveA({ item: kit, type: 'check_in', toLocation: storeA });
    for (const id of [kit, ...ids])
      expect(await state(id)).toMatchObject({
        status: 'available',
        holder_user_id: null,
        location_id: storeA,
      });
  });

  it('is blocked by a part that was checked out on its own, naming the part', async () => {
    const { kit, ids } = await kitWithParts();
    await moveA({ item: ids[0]!, type: 'check_out', toUser: userB });
    const part = (
      await admin.query<{ asset_number: string }>(
        'SELECT asset_number FROM register.items WHERE id = $1',
        [ids[0]],
      )
    ).rows[0]!;
    await expect(moveA({ item: kit, type: 'check_out', toUser: userA })).rejects.toMatchObject({
      constraint: 'movements_kit_part_unavailable',
      message: expect.stringContaining(part.asset_number),
    });
    // Nothing moved: not the kit, not the other part.
    expect((await state(kit)).status).toBe('available');
    expect((await state(ids[1]!)).status).toBe('available');
  });

  it('never moves a part on its own while its kit is out', async () => {
    const { kit, ids } = await kitWithParts(1);
    await moveA({ item: kit, type: 'check_out', toUser: userA });
    await expect(
      moveA({ item: ids[0]!, type: 'check_in', toLocation: storeA }),
    ).rejects.toMatchObject({
      constraint: 'movements_part_of_kit',
    });
    await expect(moveA({ item: ids[0]!, type: 'check_out', toUser: userA })).rejects.toBeDefined();
  });

  it('reports a kit missing with its parts, and finds them together', async () => {
    const { kit, ids } = await kitWithParts();
    await moveA({ item: kit, type: 'missing' });
    for (const id of [kit, ...ids]) expect((await state(id)).status).toBe('missing');
    await moveA({ item: kit, type: 'found', toLocation: storeA });
    for (const id of [kit, ...ids])
      expect(await state(id)).toMatchObject({ status: 'available', location_id: storeA });
  });
});

describe('missing and found', () => {
  it('a missing item is on no one’s list and can be found where it turns up', async () => {
    const id = await item(siteA, { location_id: storeA });
    await moveA({ item: id, type: 'check_out', toUser: userA });
    await moveA({ item: id, type: 'missing', note: 'Not in the van' });
    expect(await state(id)).toMatchObject({
      status: 'missing',
      holder_user_id: null,
      location_id: null,
    });
    const { rows } = await admin.query(
      `SELECT from_user_id, created_by FROM movements.movements WHERE item_id = $1 AND movement_type = 'missing'`,
      [id],
    );
    expect(rows[0]).toEqual({ from_user_id: userA, created_by: userA });
    await expect(moveA({ item: id, type: 'check_in', toLocation: storeA })).rejects.toBeDefined();
    await moveA({ item: id, type: 'found', toLocation: vanA });
    expect(await state(id)).toMatchObject({ status: 'out', location_id: vanA });
  });

  it('only an item reported missing can be found', async () => {
    const id = await item();
    await expect(moveA({ item: id, type: 'found', toLocation: storeA })).rejects.toMatchObject({
      constraint: 'movements_found_missing',
    });
  });
});

describe('depot scope', () => {
  it('refuses a movement for another depot’s item, and does not reveal it', async () => {
    const id = await item(siteB);
    await expect(
      asApp([siteA], userA, (c) =>
        move(c, { site: siteB, item: id, type: 'check_out', toUser: userA }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asApp([siteA], userA, (c) =>
        move(c, { site: siteA, item: id, type: 'check_out', toUser: userA }),
      ),
    ).rejects.toMatchObject({ code: 'P0002' });
    expect((await state(id)).status).toBe('available');
  });

  it('refuses a location from another depot', async () => {
    const id = await item();
    await expect(moveA({ item: id, type: 'check_out', toLocation: storeB })).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('shows a depot only its own movements', async () => {
    const id = await item(siteB);
    await asApp([siteB], userB, (c) =>
      move(c, { site: siteB, item: id, type: 'check_out', toUser: userB }),
    );
    const seen = await asApp([siteA], userA, (c) =>
      c.query('SELECT 1 FROM movements.movements WHERE item_id = $1', [id]),
    );
    expect(seen.rows).toHaveLength(0);
  });
});

describe('transfers between depots', () => {
  async function send(
    itemId: string,
    toSite = siteB,
    kitTransfer: string | null = null,
    by = userA,
  ) {
    return asApp([siteA], by, async (c) => {
      const info = (
        await c.query<{ asset_number: string }>(
          'SELECT asset_number FROM register.items WHERE id = $1',
          [itemId],
        )
      ).rows[0]!;
      const tr = await c.query<{ id: string }>(
        `INSERT INTO movements.transfers (site_id, to_site_id, item_id, kit_transfer_id, from_site_code, to_site_code, from_time_zone, asset_number, kind_name, carrier, expected_on)
         VALUES ($1, $2, $3, $4, 'MA', 'MB', 'Europe/London', $5, 'Kind', 'Depot van', $6) RETURNING id`,
        [siteA, toSite, itemId, kitTransfer, info.asset_number, future(2)],
      );
      return tr.rows[0]!.id;
    });
  }
  const sendMove = (itemId: string, transfer: string) =>
    moveA({ item: itemId, type: 'transfer_out', transfer });

  it('sends an item into transit, which can’t be checked out, and receives it at the other depot', async () => {
    const id = await item(siteA, { location_id: storeA });
    const transfer = await send(id);
    await sendMove(id, transfer);
    expect(await state(id)).toMatchObject({
      status: 'in_transit',
      location_id: null,
      holder_user_id: null,
    });
    await expect(moveA({ item: id, type: 'check_out', toUser: userA })).rejects.toMatchObject({
      message: expect.stringContaining('in transit'),
    });
    // The sending depot can't receive it; only the destination can.
    await expect(
      moveA({ item: id, type: 'transfer_in', toLocation: storeA, transfer }),
    ).rejects.toBeDefined();
    await asApp([siteB], userB, (c) =>
      move(c, {
        site: siteB,
        item: id,
        type: 'transfer_in',
        toLocation: storeB,
        transfer,
        note: 'All present',
      }),
    );
    expect(await state(id)).toMatchObject({
      status: 'available',
      location_id: storeB,
      site_id: siteB,
    });
    const tr = (
      await admin.query(
        'SELECT status, closed_by, received_location_id, received_note FROM movements.transfers WHERE id = $1',
        [transfer],
      )
    ).rows[0];
    expect(tr).toEqual({
      status: 'received',
      closed_by: userB,
      received_location_id: storeB,
      received_note: 'All present',
    });
    // Now it is depot B's item to check out; depot A has lost it.
    await asApp([siteB], userB, (c) =>
      move(c, { site: siteB, item: id, type: 'check_out', toUser: userB }),
    );
    await expect(moveA({ item: id, type: 'check_out', toUser: userA })).rejects.toBeDefined();
  });

  it('is visible to both depots and to no other, and neither sees the other’s other items', async () => {
    const id = await item(siteA);
    const other = await item(siteA);
    const transfer = await send(id);
    await sendMove(id, transfer);
    const seen = async (site: string) =>
      asApp([site], userA, async (c) => ({
        transfer: (
          await c.query('SELECT asset_number FROM movements.transfers WHERE id = $1', [transfer])
        ).rowCount,
        item: (await c.query('SELECT 1 FROM register.items WHERE id = $1', [id])).rowCount,
        other: (await c.query('SELECT 1 FROM register.items WHERE id = $1', [other])).rowCount,
      }));
    expect(await seen(siteA)).toEqual({ transfer: 1, item: 1, other: 1 });
    expect(await seen(siteB)).toEqual({ transfer: 1, item: 0, other: 0 });
    expect(await seen(siteC)).toEqual({ transfer: 0, item: 0, other: 0 });
    // The receiving depot can't edit or delete the transfer, only close it by receiving.
    await expect(
      asApp([siteB], userB, (c) =>
        c.query(
          `UPDATE movements.transfers SET status = 'received', closed_at = now() WHERE id = $1`,
          [transfer],
        ),
      ),
    ).rejects.toMatchObject({ constraint: 'transfers_closed_by_movement' });
    await expect(
      asApp([siteB], userB, (c) =>
        c.query('DELETE FROM movements.transfers WHERE id = $1', [transfer]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses a transfer to its own depot, and a second open transfer of the same item', async () => {
    const id = await item();
    await expect(send(id, siteA)).rejects.toMatchObject({
      constraint: 'transfers_different_depots',
    });
    const first = await send(id);
    await sendMove(id, first);
    await expect(send(id)).rejects.toMatchObject({ constraint: 'transfers_one_open_per_item' });
  });

  it('only an available item can be sent', async () => {
    const id = await item();
    await moveA({ item: id, type: 'check_out', toUser: userA });
    const transfer = await send(id);
    await expect(sendMove(id, transfer)).rejects.toMatchObject({
      constraint: 'movements_transfer_available',
    });
  });

  it('can be taken back by the sender, and photos follow the item when it is received', async () => {
    const id = await item(siteA, { location_id: storeA });
    await admin.query(
      `INSERT INTO register.item_photos (site_id, item_id, content_type, byte_size, width, height, sha256, storage_key)
       VALUES ($1, $2::uuid, 'image/jpeg', 100, 10, 10, repeat('a', 64), 'items/' || $2::text || '/' || public.uuid_v7() || '.jpg')`,
      [siteA, id],
    );
    const cancelled = await send(id);
    await sendMove(id, cancelled);
    await moveA({ item: id, type: 'transfer_cancel', toLocation: storeA, transfer: cancelled });
    expect(await state(id)).toMatchObject({
      status: 'available',
      location_id: storeA,
      site_id: siteA,
    });
    expect(
      (await admin.query('SELECT status FROM movements.transfers WHERE id = $1', [cancelled]))
        .rows[0].status,
    ).toBe('cancelled');
    const again = await send(id);
    await sendMove(id, again);
    await asApp([siteB], userB, (c) =>
      move(c, { site: siteB, item: id, type: 'transfer_in', toLocation: storeB, transfer: again }),
    );
    const photo = await admin.query('SELECT site_id FROM register.item_photos WHERE item_id = $1', [
      id,
    ]);
    expect(photo.rows[0].site_id).toBe(siteB);
  });

  it('sends a kit with its parts and receives them together', async () => {
    const kit = await item(siteA, { is_kit: true, location_id: storeA });
    const part = await item(siteA, { parent_id: kit, location_id: storeA });
    const kitTransfer = await send(kit);
    await send(part, siteB, kitTransfer);
    await sendMove(kit, kitTransfer);
    expect((await state(part)).status).toBe('in_transit');
    // A part can't be received on its own.
    const partTransfer = (
      await admin.query<{ id: string }>('SELECT id FROM movements.transfers WHERE item_id = $1', [
        part,
      ])
    ).rows[0]!.id;
    await expect(
      asApp([siteB], userB, (c) =>
        move(c, {
          site: siteB,
          item: part,
          type: 'transfer_in',
          toLocation: storeB,
          transfer: partTransfer,
        }),
      ),
    ).rejects.toMatchObject({ constraint: 'movements_part_of_kit' });
    await asApp([siteB], userB, (c) =>
      move(c, {
        site: siteB,
        item: kit,
        type: 'transfer_in',
        toLocation: storeB,
        transfer: kitTransfer,
      }),
    );
    for (const id of [kit, part])
      expect(await state(id)).toMatchObject({
        status: 'available',
        site_id: siteB,
        location_id: storeB,
      });
    const closed = await admin.query(`SELECT status FROM movements.transfers WHERE id = ANY($1)`, [
      [kitTransfer, partTransfer],
    ]);
    expect(closed.rows.map((r) => r.status)).toEqual(['received', 'received']);
  });
});

describe('stocktakes', () => {
  it('has one count at a time per location, and a closed count never changes', async () => {
    const stocktake = async () =>
      asApp([siteA], userA, (c) =>
        c.query<{ id: string }>(
          `INSERT INTO movements.stocktakes (site_id, location_id) VALUES ($1, $2) RETURNING id`,
          [siteA, storeA],
        ),
      );
    const first = (await stocktake()).rows[0]!.id;
    await expect(stocktake()).rejects.toMatchObject({
      constraint: 'stocktakes_one_counting_per_location',
    });
    const id = await item(siteA, { location_id: storeA });
    await asApp([siteA], userA, (c) =>
      c.query(
        `INSERT INTO movements.stocktake_lines (site_id, stocktake_id, item_id, scanned_at, scanned_by) VALUES ($1, $2, $3, now(), $4)`,
        [siteA, first, id, userA],
      ),
    );
    await expect(
      asApp([siteA], userA, (c) =>
        c.query(
          `INSERT INTO movements.stocktake_lines (site_id, stocktake_id, item_id) VALUES ($1, $2, $3)`,
          [siteA, first, id],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await asApp([siteA], userA, (c) =>
      c.query(
        `UPDATE movements.stocktakes SET status = 'closed', closed_at = now(), closed_by = $2, expected_count = 1, found_count = 1, not_found_count = 0, unexpected_count = 0 WHERE id = $1`,
        [first, userA],
      ),
    );
    const lateItem = await item(siteA);
    await expect(
      asApp([siteA], userA, (c) =>
        c.query(`UPDATE movements.stocktakes SET note = 'late' WHERE id = $1`, [first]),
      ),
    ).rejects.toMatchObject({ constraint: 'stocktakes_closed_final' });
    await expect(
      asApp([siteA], userA, (c) =>
        c.query(
          `INSERT INTO movements.stocktake_lines (site_id, stocktake_id, item_id) VALUES ($1, $2, $3)`,
          [siteA, first, lateItem],
        ),
      ),
    ).rejects.toMatchObject({ constraint: 'stocktake_lines_closed_final' });
    // A fresh count of the same location can then begin.
    await stocktake();
  });

  it('ties a decision to its outcome, and an ignored item needs a reason', async () => {
    const st = (
      await admin.query<{ id: string }>(
        `INSERT INTO movements.stocktakes (site_id, location_id) VALUES ($1, $2) RETURNING id`,
        [siteA, vanA],
      )
    ).rows[0]!.id;
    const line = (
      await admin.query<{ id: string }>(
        `INSERT INTO movements.stocktake_lines (site_id, stocktake_id, item_id) VALUES ($1, $2, $3) RETURNING id`,
        [siteA, st, await item()],
      )
    ).rows[0]!.id;
    await expect(
      admin.query(
        `UPDATE movements.stocktake_lines SET outcome = 'not_found', decision = 'moved_here' WHERE id = $1`,
        [line],
      ),
    ).rejects.toMatchObject({ constraint: 'stocktake_lines_decision' });
    await expect(
      admin.query(
        `UPDATE movements.stocktake_lines SET outcome = 'not_found', decision = 'ignored' WHERE id = $1`,
        [line],
      ),
    ).rejects.toMatchObject({ constraint: 'stocktake_lines_ignored_reason' });
    await admin.query(
      `UPDATE movements.stocktake_lines SET outcome = 'not_found', decision = 'ignored', reason = 'On hire to a customer' WHERE id = $1`,
      [line],
    );
  });
});
