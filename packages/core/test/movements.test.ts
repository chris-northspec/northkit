import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '../src/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/errors';
import { createItem, getItem, setItemKit, updateItem } from '../src/services/items';
import { listKinds } from '../src/services/kinds';
import {
  checkIn,
  checkOut,
  checkOutMany,
  itemMovements,
  markFound,
  movementChoices,
  myKit,
  overdueItems,
  reportMissing,
  suggestedDueBack,
  addDays,
  today,
  whoHasWhat,
  whoHasWhatCsv,
  missingItems,
  recordedAt,
} from '../src/services/movements';
import {
  cancelTransfer,
  incomingTransferFor,
  listTransfers,
  receiveTransfer,
  sendTransfer,
  transferDestinations,
} from '../src/services/transfers';
import {
  closeStocktake,
  countableLocations,
  scanStocktake,
  startStocktake,
  stocktakeResult,
} from '../src/services/stocktakes';
import { fixtures, type Fixtures } from './fixtures';

// S3-2 to S3-5 through the services, as a person would use them: who may check out and in
// (K21, K37), the database's reasons coming back in words, offline replays applied once
// (A16), kit sets, who-has-what, transfers between depots (A18) and stocktakes (A17).
// The rules themselves are proved in packages/db/test/movements.test.ts.

let f: Fixtures;
let siteA: string;
let siteB: string;
let manager: ActorContext;
let supervisor: ActorContext;
let operative: ActorContext;
let otherOperative: ActorContext;
let viewer: ActorContext;
let atB: ActorContext;
let storeA: string;
let vanA: string;
let jobA: string;
let storeB: string;
let kindId: string;
let n = 0;

async function newItem(extra: Record<string, unknown> = {}) {
  return createItem(f.db, manager, {
    siteId: siteA,
    kindId,
    assetNumber: `SV${++n}${f.tag}`,
    locationId: storeA,
    ...extra,
  });
}

const to = (
  kind: 'me' | 'person' | 'site' | 'store' | 'my_van',
  extra: Record<string, string> = {},
) => ({
  kind,
  ...extra,
});
const future = (days: number) => addDays(today(new Date(), 'Europe/London'), days);

beforeAll(async () => {
  f = fixtures();
  siteA = await f.site(`MA${f.tag}`, 'Movements depot A');
  siteB = await f.site(`MB${f.tag}`, 'Movements depot B');
  const loc = async (site: string, kind: string, code: string, assigned: string | null = null) =>
    (
      await f.admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name, assigned_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [site, kind, code, `${code} name`, assigned],
      )
    ).rows[0]!.id;
  const mgr = await f.user({ roles: ['kit_manager'], siteIds: [siteA] });
  const sup = await f.user({ roles: ['supervisor'], siteIds: [siteA] });
  const op = await f.user({ roles: ['operative'], siteIds: [siteA] });
  const op2 = await f.user({ roles: ['operative'], siteIds: [siteA] });
  const view = await f.user({ roles: ['viewer'], siteIds: [siteA] });
  const b = await f.user({ roles: ['supervisor'], siteIds: [siteB] });
  storeA = await loc(siteA, 'store', 'STORE');
  vanA = await loc(siteA, 'van', 'VAN1', op.id);
  jobA = await loc(siteA, 'site', 'JOB1');
  storeB = await loc(siteB, 'store', 'STORE');
  manager = await f.actor(mgr.id);
  supervisor = await f.actor(sup.id);
  operative = await f.actor(op.id);
  otherOperative = await f.actor(op2.id);
  viewer = await f.actor(view.id);
  atB = await f.actor(b.id);
  kindId = (await listKinds(f.db, manager)).find((k) => k.name === 'Power tool')!.id;
});
afterAll(() => f.close());

describe('check-out and check-in in two taps (A10)', () => {
  it('checks an item out to a person and back in, and the history says who, when and from where', async () => {
    const item = await newItem();
    const out = await checkOut(f.db, operative, {
      itemId: item.id,
      destination: to('me'),
      note: 'Smith job',
    });
    expect(out).toMatchObject({ status: 'out', replayed: false });
    expect(out.message).toBe(`${item.asset_number} checked out to you.`);
    const held = await getItem(f.db, operative, item.id);
    expect(held.item).toMatchObject({
      status: 'out',
      holder_user_id: operative.userId,
      location_id: null,
    });
    const back = await checkIn(f.db, operative, { itemId: item.id, note: 'Chuck loose' });
    expect(back.message).toContain('checked in to STORE name');
    expect((await getItem(f.db, operative, item.id)).item).toMatchObject({
      status: 'available',
      holder_user_id: null,
      location_id: storeA,
    });
    const history = await itemMovements(f.db, operative, item.id);
    expect(history.map((h) => [h.type, h.byName, h.fromLabel, h.toLabel])).toEqual([
      ['check_in', expect.any(String), expect.any(String), 'STORE name'],
      ['check_out', expect.any(String), 'STORE name', expect.any(String)],
    ]);
    expect(history[0]!.note).toBe('Chuck loose');
  });

  it('says why an item can’t go out, in words', async () => {
    const item = await newItem();
    await checkOut(f.db, manager, { itemId: item.id, destination: to('me') });
    await expect(
      checkOut(f.db, supervisor, { itemId: item.id, destination: to('me') }),
    ).rejects.toThrow(new ConflictError(`${item.asset_number} is already out. Check it in first.`));
    await reportMissing(f.db, manager, { itemId: item.id });
    await expect(
      checkOut(f.db, supervisor, { itemId: item.id, destination: to('me') }),
    ).rejects.toThrow(/reported missing/);
    const q = await newItem();
    await f.admin.query(`UPDATE register.items SET status = 'quarantined' WHERE id = $1`, [q.id]);
    await expect(
      checkOut(f.db, supervisor, { itemId: q.id, destination: to('me') }),
    ).rejects.toThrow(/quarantined and can't be checked out until a passed inspection is recorded/);
  });

  it('offers a due-back date from the kind (or the organisation setting)', async () => {
    const item = await newItem();
    expect(await suggestedDueBack(f.db, operative, [item.id])).toBe(future(7));
    const out = await checkOut(f.db, operative, {
      itemId: item.id,
      destination: to('me'),
      dueBackOn: future(2),
    });
    expect(out.status).toBe('out');
    await expect(
      checkOut(f.db, manager, {
        itemId: (await newItem()).id,
        destination: to('me'),
        dueBackOn: '2020-01-01',
      }),
    ).rejects.toThrow(/before today/);
    await expect(
      checkOut(f.db, manager, {
        itemId: (await newItem()).id,
        destination: to('me'),
        dueBackOn: 'soon',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to move an item between its place by editing it: the position moves only by movement', async () => {
    const item = await newItem();
    await checkOut(f.db, manager, {
      itemId: item.id,
      destination: to('site', { locationId: jobA }),
    });
    const current = (await getItem(f.db, manager, item.id)).item;
    // An edit that includes the old location is fine; the location itself can't be changed by it.
    const edited = await updateItem(f.db, manager, item.id, current.row_version, {
      siteId: siteA,
      kindId,
      assetNumber: current.asset_number,
      notes: 'Edited while out',
      locationId: storeA,
    });
    expect(edited).toMatchObject({ location_id: jobA, status: 'out', notes: 'Edited while out' });
  });
});

describe('who may do what (K21, K37)', () => {
  it('lets an Operative check out and in to themselves and their own van only', async () => {
    const item = await newItem();
    await expect(
      checkOut(f.db, operative, {
        itemId: item.id,
        destination: to('person', { userId: otherOperative.userId }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      checkOut(f.db, operative, { itemId: item.id, destination: to('site', { locationId: jobA }) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      checkOut(f.db, operative, {
        itemId: item.id,
        destination: to('store', { locationId: storeA }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await checkOut(f.db, operative, { itemId: item.id, destination: to('my_van') });
    expect((await getItem(f.db, operative, item.id)).item).toMatchObject({
      status: 'out',
      location_id: vanA,
    });
    // Another Operative has no van here, and can't touch someone else's kit.
    await expect(
      checkOut(f.db, otherOperative, { itemId: (await newItem()).id, destination: to('my_van') }),
    ).rejects.toThrow(/don’t have a van/);
    await expect(checkIn(f.db, otherOperative, { itemId: item.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await checkIn(f.db, operative, { itemId: item.id });
  });

  it('lets a Supervisor do the same for anyone at their depot, and a Kit Manager anything', async () => {
    const item = await newItem();
    await checkOut(f.db, supervisor, {
      itemId: item.id,
      destination: to('person', { userId: otherOperative.userId }),
    });
    expect((await getItem(f.db, supervisor, item.id)).item.holder_user_id).toBe(
      otherOperative.userId,
    );
    await checkIn(f.db, supervisor, { itemId: item.id });
    // A person who doesn't work at the depot: a Supervisor can't, a Kit Manager can.
    const stranger = await f.user({ roles: ['operative'], siteIds: [siteB] });
    const again = await newItem();
    await expect(
      checkOut(f.db, supervisor, {
        itemId: again.id,
        destination: to('person', { userId: stranger.id }),
      }),
    ).rejects.toThrow(/doesn’t work at this depot/);
    await checkOut(f.db, manager, {
      itemId: again.id,
      destination: to('person', { userId: stranger.id }),
    });
  });

  it('lets a Viewer see but not move kit, and keeps depots apart', async () => {
    const item = await newItem();
    await expect(
      checkOut(f.db, viewer, { itemId: item.id, destination: to('me') }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      checkOut(f.db, atB, { itemId: item.id, destination: to('me') }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(itemMovements(f.db, atB, item.id)).resolves.toEqual([]);
  });

  it('refuses a place at another depot', async () => {
    const item = await newItem();
    await expect(
      checkOut(f.db, manager, {
        itemId: item.id,
        destination: to('store', { locationId: storeB }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('a phone replaying a change applies it once (A16, S3-6)', () => {
  it('returns the same answer for the same client id, and adds nothing', async () => {
    const item = await newItem();
    const id = randomUUID();
    const when = new Date(Date.now() - 3_600_000).toISOString();
    const first = await checkOut(f.db, operative, {
      clientId: id,
      itemId: item.id,
      destination: to('me'),
      occurredAt: when,
    });
    const second = await checkOut(f.db, operative, {
      clientId: id,
      itemId: item.id,
      destination: to('me'),
      occurredAt: when,
    });
    expect(second).toMatchObject({ movementId: first.movementId, replayed: true });
    const history = await itemMovements(f.db, operative, item.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.offline).toBe(true);
    expect(history[0]!.occurredAt.getTime()).toBe(new Date(when).getTime());
  });

  it('refuses the change when the item moved on while the phone was offline, saying why', async () => {
    const item = await newItem();
    // Someone else checked it out while this phone had no signal.
    await checkOut(f.db, manager, { itemId: item.id, destination: to('me') });
    await expect(
      checkOut(f.db, operative, {
        clientId: randomUUID(),
        itemId: item.id,
        destination: to('me'),
        occurredAt: new Date(Date.now() - 600_000).toISOString(),
      }),
    ).rejects.toThrow(`${item.asset_number} is already out. Check it in first.`);
    // And it was not applied: the item is still with the manager.
    expect((await getItem(f.db, manager, item.id)).item.holder_user_id).toBe(manager.userId);
  });

  it('refuses a movement from the future or from too long ago', () => {
    expect(() => recordedAt(new Date(Date.now() + 3_600_000).toISOString())).toThrow(/future/);
    expect(() => recordedAt(new Date(Date.now() - 200 * 86_400_000).toISOString())).toThrow(
      /days ago/,
    );
    expect(recordedAt(undefined, new Date('2026-11-19T10:00:00Z')).toISOString()).toBe(
      '2026-11-19T10:00:00.000Z',
    );
  });

  it('won’t let one person reuse another’s id', async () => {
    const item = await newItem();
    const id = randomUUID();
    await checkOut(f.db, operative, { clientId: id, itemId: item.id, destination: to('me') });
    await expect(
      checkOut(f.db, manager, { clientId: id, itemId: item.id, destination: to('me') }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('bulk check-out', () => {
  it('moves every item that can go and names each one that can’t, and why', async () => {
    const [a, b, c] = [await newItem(), await newItem(), await newItem()];
    await reportMissing(f.db, manager, { itemId: b.id });
    const result = await checkOutMany(f.db, manager, {
      itemIds: [a.id, b.id, c.id],
      destination: to('site', { locationId: jobA }),
    });
    expect(result.done.map((d) => d.assetNumber).sort()).toEqual(
      [a.asset_number, c.asset_number].sort(),
    );
    expect(result.refused).toEqual([
      {
        itemId: b.id,
        assetNumber: b.asset_number,
        reason: expect.stringContaining('reported missing'),
      },
    ]);
    expect((await getItem(f.db, manager, a.id)).item).toMatchObject({
      status: 'out',
      location_id: jobA,
    });
    expect((await getItem(f.db, manager, b.id)).item.status).toBe('missing');
  });
});

describe('kit sets move together', () => {
  it('checks a kit and its parts out and in, and a part out on its own blocks the kit by name', async () => {
    const kit = await newItem({ isKit: true });
    const p1 = await newItem();
    const p2 = await newItem();
    await setItemKit(f.db, manager, p1.id, kit.id);
    await setItemKit(f.db, manager, p2.id, kit.id);
    await checkOut(f.db, manager, { itemId: p1.id, destination: to('me') });
    await expect(
      checkOut(f.db, manager, { itemId: kit.id, destination: to('me') }),
    ).rejects.toThrow(
      `Kit ${kit.asset_number} can't be checked out: its item ${p1.asset_number} is out on its own.`,
    );
    await checkIn(f.db, manager, { itemId: p1.id });
    await checkOut(f.db, manager, { itemId: kit.id, destination: to('me'), dueBackOn: future(3) });
    for (const id of [kit.id, p1.id, p2.id])
      expect((await getItem(f.db, manager, id)).item.status).toBe('out');
    await checkIn(f.db, manager, { itemId: kit.id });
    for (const id of [kit.id, p1.id, p2.id])
      expect((await getItem(f.db, manager, id)).item.status).toBe('available');
  });
});

describe('missing and found (CO-4)', () => {
  it('reports an item missing with who and when, lists it, and finds it again where it turned up', async () => {
    const item = await newItem();
    await checkOut(f.db, operative, { itemId: item.id, destination: to('me') });
    await reportMissing(f.db, operative, { itemId: item.id, note: 'Left on site' });
    const missing = await missingItems(f.db, supervisor, { siteIds: [siteA] });
    expect(missing.find((m) => m.id === item.id)).toMatchObject({
      assetNumber: item.asset_number,
      reportedBy: expect.any(String),
      note: 'Left on site',
    });
    await expect(
      markFound(f.db, operative, { itemId: item.id, locationId: storeA }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await markFound(f.db, supervisor, { itemId: item.id, locationId: storeA });
    expect((await getItem(f.db, supervisor, item.id)).item).toMatchObject({
      status: 'available',
      location_id: storeA,
    });
    expect(
      (await missingItems(f.db, supervisor, { siteIds: [siteA] })).some((m) => m.id === item.id),
    ).toBe(false);
  });
});

describe('who has what, My kit and overdue returns (S3-4, A20)', () => {
  it('groups what is out by person, van, site and store, each with a count and overdue returns', async () => {
    const mine = await newItem();
    const inVan = await newItem();
    const onSite = await newItem();
    await checkOut(f.db, operative, {
      itemId: mine.id,
      destination: to('me'),
      dueBackOn: future(1),
    });
    await checkOut(f.db, operative, { itemId: inVan.id, destination: to('my_van') });
    await checkOut(f.db, manager, {
      itemId: onSite.id,
      destination: to('site', { locationId: jobA }),
    });
    // Make `mine` overdue: its due date passed yesterday.
    await f.admin.query('ALTER TABLE register.items DISABLE TRIGGER guard_item_whereabouts');
    await f.admin.query(
      `UPDATE register.items SET due_back_on = current_date - 1, overdue_at = now() - interval '1 hour' WHERE id = $1`,
      [mine.id],
    );
    await f.admin.query('ALTER TABLE register.items ENABLE TRIGGER guard_item_whereabouts');
    const people = await whoHasWhat(f.db, supervisor, 'person', { siteIds: [siteA] });
    const me = people.find((g) => g.key === operative.userId)!;
    expect(me.count).toBeGreaterThanOrEqual(1);
    expect(me.overdue).toBe(1);
    expect(me.items.find((i) => i.id === mine.id)).toMatchObject({
      assetNumber: mine.asset_number,
      overdue: true,
    });
    const vans = await whoHasWhat(f.db, supervisor, 'van', { siteIds: [siteA] });
    expect(vans.find((g) => g.key === vanA)!.items.map((i) => i.id)).toContain(inVan.id);
    const sites = await whoHasWhat(f.db, supervisor, 'site', { siteIds: [siteA] });
    expect(sites.find((g) => g.key === jobA)!.items.map((i) => i.id)).toContain(onSite.id);
    const stores = await whoHasWhat(f.db, supervisor, 'store', { siteIds: [siteA] });
    expect(stores.find((g) => g.key === storeA)!.count).toBeGreaterThan(0);
    // The overdue list, and the operative's own page: what they hold and what is in their van.
    expect((await overdueItems(f.db, supervisor, { siteIds: [siteA] })).map((i) => i.id)).toContain(
      mine.id,
    );
    const kit = await myKit(f.db, operative);
    expect(kit.map((i) => i.id)).toEqual(expect.arrayContaining([mine.id, inVan.id]));
    expect(kit[0]!.id).toBe(mine.id);
    await expect(myKit(f.db, operative, otherOperative.userId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const csv = await whoHasWhatCsv(f.db, supervisor, 'person', [siteA]);
    expect(csv.split('\r\n')[0]).toBe(
      'Group,Depot,Asset number,Kind,Description,Status,Due back,Overdue,Kit',
    );
    expect(csv).toContain(mine.asset_number);
  });

  it('offers the right people and places to each role', async () => {
    const forOperative = await movementChoices(f.db, operative);
    expect(forOperative.people).toEqual([]);
    expect(forOperative.places.find((p) => p.id === vanA)).toMatchObject({ assignedToMe: true });
    const forSupervisor = await movementChoices(f.db, supervisor);
    expect(forSupervisor.people.map((p) => p.id)).toContain(operative.userId);
    expect(forSupervisor.homeStores[siteA]).toBe(storeA);
  });
});

describe('transfers between depots (A18)', () => {
  it('sends, shows at both depots only, can’t be checked out in transit, and is received by the other depot', async () => {
    const item = await newItem();
    const other = await newItem();
    expect((await transferDestinations(f.db, supervisor)).map((d) => d.id)).toEqual(
      expect.arrayContaining([siteA, siteB]),
    );
    await expect(
      sendTransfer(f.db, operative, {
        itemId: item.id,
        toSiteId: siteB,
        carrier: 'Van',
        expectedOn: future(2),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sendTransfer(f.db, supervisor, {
        itemId: item.id,
        toSiteId: siteA,
        carrier: 'Van',
        expectedOn: future(2),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const sent = await sendTransfer(f.db, supervisor, {
      itemId: item.id,
      toSiteId: siteB,
      carrier: 'Depot van 3',
      expectedOn: future(2),
      note: 'Urgent',
    });
    expect(sent.message).toContain('in transit');
    await expect(
      checkOut(f.db, manager, { itemId: item.id, destination: to('me') }),
    ).rejects.toThrow(/in transit/);
    const seenByB = await listTransfers(f.db, atB);
    expect(seenByB.map((t) => t.assetNumber)).toEqual([item.asset_number]);
    expect(seenByB[0]).toMatchObject({
      incoming: true,
      carrier: 'Depot van 3',
      fromSiteCode: expect.stringContaining('MA'),
      status: 'in_transit',
    });
    expect(
      (await listTransfers(f.db, supervisor)).find((t) => t.assetNumber === item.asset_number),
    ).toMatchObject({ incoming: false });
    // B sees the transfer but nothing else of A's.
    await expect(getItem(f.db, atB, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getItem(f.db, atB, other.id)).rejects.toBeInstanceOf(NotFoundError);
    // Scanning at B finds the transfer to receive.
    const scanned = await incomingTransferFor(f.db, atB, item.id);
    expect(scanned?.id).toBe(sent.transferId);
    await expect(
      receiveTransfer(f.db, supervisor, { transferId: sent.transferId, locationId: storeA }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveTransfer(f.db, atB, { transferId: sent.transferId, locationId: storeA }),
    ).rejects.toBeInstanceOf(ValidationError);
    const got = await receiveTransfer(f.db, atB, {
      transferId: sent.transferId,
      locationId: storeB,
      note: 'Box damaged',
    });
    expect(got.message).toBe(`${item.asset_number} received at STORE name.`);
    expect((await getItem(f.db, atB, item.id)).item).toMatchObject({
      status: 'available',
      site_id: siteB,
      location_id: storeB,
    });
    await expect(getItem(f.db, supervisor, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveTransfer(f.db, atB, { transferId: sent.transferId, locationId: storeB }),
    ).rejects.toThrow(/already been received/);
    expect(await listTransfers(f.db, atB)).toEqual([]);
  });

  it('puts a transfer past its expected date on the list as overdue, and lets the sender take it back', async () => {
    const item = await newItem();
    const sent = await sendTransfer(f.db, supervisor, {
      itemId: item.id,
      toSiteId: siteB,
      carrier: 'Courier',
      expectedOn: future(1),
    });
    const later = new Date(Date.now() + 3 * 86_400_000);
    const rows = await listTransfers(f.db, supervisor, { now: later });
    expect(rows.find((t) => t.id === sent.transferId)?.overdue).toBe(true);
    expect(
      (await listTransfers(f.db, atB, { now: later })).find((t) => t.id === sent.transferId)
        ?.overdue,
    ).toBe(true);
    expect(
      (await listTransfers(f.db, supervisor)).find((t) => t.id === sent.transferId)?.overdue,
    ).toBe(false);
    await cancelTransfer(f.db, supervisor, sent.transferId, storeA, 'Sent by mistake');
    expect((await getItem(f.db, supervisor, item.id)).item).toMatchObject({
      status: 'available',
      location_id: storeA,
    });
  });

  it('sends a kit with its parts', async () => {
    const kit = await newItem({ isKit: true });
    const part = await newItem();
    await setItemKit(f.db, manager, part.id, kit.id);
    const sent = await sendTransfer(f.db, supervisor, {
      itemId: kit.id,
      toSiteId: siteB,
      carrier: 'Van',
      expectedOn: future(1),
    });
    const [t] = (await listTransfers(f.db, atB)).filter((r) => r.id === sent.transferId);
    expect(t).toMatchObject({ parts: 1 });
    await receiveTransfer(f.db, atB, { transferId: sent.transferId, locationId: storeB });
    for (const id of [kit.id, part.id])
      expect((await getItem(f.db, atB, id)).item).toMatchObject({
        site_id: siteB,
        status: 'available',
      });
  });
});

describe('stocktake by location (A17)', () => {
  it('reports expected and found, expected but not found, and found but not expected, and applies only the choices made', async () => {
    const cage = (
      await f.admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', 'CAGE', 'Tool cage') RETURNING id`,
        [siteA],
      )
    ).rows[0]!.id;
    const here = await newItem({ locationId: cage });
    const gone = await newItem({ locationId: cage });
    const ignored = await newItem({ locationId: cage });
    const stray = await newItem({ locationId: storeA });
    const kept = await newItem({ locationId: storeA });
    const st = await startStocktake(f.db, operative, { locationId: cage });
    await expect(startStocktake(f.db, operative, { locationId: cage })).rejects.toThrow(
      /already being counted/,
    );
    for (const id of [here.id, stray.id, kept.id])
      await scanStocktake(f.db, operative, { stocktakeId: st.id, itemId: id });
    expect(
      await scanStocktake(f.db, operative, { stocktakeId: st.id, itemId: here.id }),
    ).toMatchObject({ already: true });
    const result = await stocktakeResult(f.db, operative, st.id);
    expect(result.found.map((l) => l.itemId)).toEqual([here.id]);
    expect(result.notFound.map((l) => l.itemId).sort()).toEqual([gone.id, ignored.id].sort());
    expect(result.unexpected.map((l) => l.itemId).sort()).toEqual([stray.id, kept.id].sort());
    expect(result.unexpected[0]).toMatchObject({ canMove: true, elsewhere: 'STORE name' });
    // Closing needs a Supervisor and a choice for every line that needs one.
    await expect(
      closeStocktake(f.db, operative, { stocktakeId: st.id, decisions: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      closeStocktake(f.db, supervisor, { stocktakeId: st.id, decisions: {} }),
    ).rejects.toThrow(/Choose what to do about each of these/);
    await expect(
      closeStocktake(f.db, supervisor, {
        stocktakeId: st.id,
        decisions: {
          [gone.id]: { decision: 'missing' },
          [ignored.id]: { decision: 'ignored' },
          [stray.id]: { decision: 'moved_here' },
          [kept.id]: { decision: 'note_only' },
        },
      }),
    ).rejects.toMatchObject({
      fields: { [`reason-${ignored.id}`]: expect.stringContaining('why') },
    });
    const closed = await closeStocktake(f.db, supervisor, {
      stocktakeId: st.id,
      note: 'Quarterly count',
      decisions: {
        [gone.id]: { decision: 'missing' },
        [ignored.id]: { decision: 'ignored', reason: 'On loan to the Smith job' },
        [stray.id]: { decision: 'moved_here' },
        [kept.id]: { decision: 'note_only' },
      },
    });
    expect(closed).toMatchObject({
      status: 'closed',
      expected: 3,
      found: 1,
      notFound: 2,
      unexpected: 2,
    });
    // Only the choices made were applied.
    expect((await getItem(f.db, manager, gone.id)).item.status).toBe('missing');
    expect((await getItem(f.db, manager, ignored.id)).item).toMatchObject({
      status: 'available',
      location_id: cage,
    });
    expect((await getItem(f.db, manager, stray.id)).item.location_id).toBe(cage);
    expect((await getItem(f.db, manager, kept.id)).item.location_id).toBe(storeA);
    // The result is kept, and the count can't be scanned into or closed again.
    const final = await stocktakeResult(f.db, supervisor, st.id);
    expect(final.notFound.find((l) => l.itemId === ignored.id)).toMatchObject({
      decision: 'ignored',
      reason: 'On loan to the Smith job',
    });
    await expect(
      scanStocktake(f.db, operative, { stocktakeId: st.id, itemId: here.id }),
    ).rejects.toThrow(/closed/);
    await expect(
      closeStocktake(f.db, supervisor, { stocktakeId: st.id, decisions: {} }),
    ).rejects.toBeInstanceOf(ConflictError);
    // The location remembers when it was counted, and drops off the "needs counting" list.
    const locations = await countableLocations(f.db, supervisor);
    expect(locations.find((l) => l.id === cage)).toMatchObject({ due: false });
    expect(locations.find((l) => l.id === storeA)).toMatchObject({
      due: true,
      lastCountedAt: null,
    });
    const farFuture = await countableLocations(
      f.db,
      supervisor,
      new Date(Date.now() + 40 * 86_400_000),
    );
    expect(farFuture.find((l) => l.id === cage)).toMatchObject({ due: true });
  });

  it('is replayed safely by a phone: the same start id gives the same count', async () => {
    const place = (
      await f.admin.query<{ id: string }>(
        `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'yard', 'YARD', 'Yard') RETURNING id`,
        [siteA],
      )
    ).rows[0]!.id;
    const id = randomUUID();
    const a = await startStocktake(f.db, operative, { clientId: id, locationId: place });
    const b = await startStocktake(f.db, operative, { clientId: id, locationId: place });
    expect(b.id).toBe(a.id);
  });

  it('keeps another depot’s counts and locations to itself', async () => {
    await expect(startStocktake(f.db, atB, { locationId: storeA })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(stocktakeResult(f.db, atB, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
