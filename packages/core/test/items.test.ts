import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '../src/context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/errors';
import {
  addKindRule,
  createKind,
  deleteKind,
  getKind,
  listKinds,
  removeKindRule,
  setKindActive,
  updateKind,
  updateKindRule,
} from '../src/services/kinds';
import {
  createItem,
  exportItemsCsv,
  getItem,
  itemHistory,
  listItems,
  listKits,
  retireItem,
  setItemKit,
  updateItem,
} from '../src/services/items';
import { fixtures, type Fixtures } from './fixtures';

// S2-1, S2-2 (acceptance A15, A21 to A25): kinds and rules, the item register, kit sets,
// retire, filters, export and site isolation, through the services as a person would use them.

let f: Fixtures;
let manager: ActorContext;
let supervisor: ActorContext;
let operative: ActorContext;
let viewer: ActorContext;
let siteA: string;
let siteB: string;
let atB: ActorContext;
let kindId: string;

const input = (extra: Record<string, unknown> = {}) => ({ siteId: siteA, kindId, ...extra });

beforeAll(async () => {
  f = fixtures();
  siteA = await f.site(`IA${f.tag}`, 'Items depot A');
  siteB = await f.site(`IB${f.tag}`, 'Items depot B');
  manager = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteA] })).id);
  supervisor = await f.actor((await f.user({ roles: ['supervisor'], siteIds: [siteA] })).id);
  operative = await f.actor((await f.user({ roles: ['operative'], siteIds: [siteA] })).id);
  viewer = await f.actor((await f.user({ roles: ['viewer'], siteIds: [siteA] })).id);
  atB = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteB] })).id);
  kindId = (await listKinds(f.db, manager)).find((k) => k.name === 'Ladder')!.id;
});
afterAll(() => f.close());

describe('kinds (S2-1)', () => {
  it('lists the starter kinds with their rules, and everyone with items.view can read them', async () => {
    const kinds = await listKinds(f.db, viewer);
    expect(kinds.map((k) => k.name)).toEqual(
      expect.arrayContaining([
        'Power tool',
        'Lifting gear',
        'Access equipment',
        'Ladder',
        'Harness',
        'PAT item',
        'Test instrument',
        'Plant',
      ]),
    );
    const lifting = kinds.find((k) => k.name === 'Lifting gear')!;
    expect(lifting.rules.find((r) => r.rule_type === 'loler')).toMatchObject({
      interval_value: 6,
      interval_unit: 'months',
      required: true,
    });
  });

  it('only a Kit Manager or Administrator can change a kind or its rules', async () => {
    for (const actor of [supervisor, operative, viewer])
      await expect(createKind(f.db, actor, { name: `Nope ${f.tag}` })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    const kind = await createKind(f.db, manager, {
      name: `Scaffold ${f.tag}`,
      assetPrefix: 'sc',
      description: 'Tube and fittings',
    });
    expect(kind.asset_prefix).toBe('SC');
    await expect(
      addKindRule(f.db, supervisor, kind.id, {
        ruleType: 'puwer',
        title: 'Inspection',
        intervalValue: 3,
        intervalUnit: 'months',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const rule = await addKindRule(f.db, manager, kind.id, {
      ruleType: 'puwer',
      title: 'Inspection',
      intervalValue: 3,
      intervalUnit: 'months',
      required: true,
      note: 'Your own setting',
    });
    const changed = await updateKindRule(f.db, manager, rule.id, rule.row_version, {
      ruleType: 'puwer',
      title: 'Inspection',
      intervalValue: 6,
      intervalUnit: 'months',
      required: true,
    });
    expect(changed.interval_value).toBe(6);
    await expect(
      updateKindRule(f.db, manager, rule.id, rule.row_version, {
        ruleType: 'puwer',
        title: 'x',
        intervalValue: 1,
        intervalUnit: 'days',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await removeKindRule(f.db, manager, rule.id);
    expect((await getKind(f.db, manager, kind.id)).rules).toHaveLength(0);
    await updateKind(f.db, manager, kind.id, kind.row_version, { name: `Scaffold ${f.tag} 2` });
  });

  it('validates rules and refuses a duplicate name', async () => {
    await expect(createKind(f.db, manager, { name: 'ladder' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const kind = await createKind(f.db, manager, { name: `Rules ${f.tag}` });
    await expect(
      addKindRule(f.db, manager, kind.id, {
        ruleType: 'puwer',
        title: 'x',
        intervalValue: 0,
        intervalUnit: 'days',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addKindRule(f.db, manager, kind.id, {
        ruleType: 'bogus' as never,
        title: 'x',
        intervalValue: 1,
        intervalUnit: 'days',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('never deletes a kind that is in use: deactivate instead; an unused one can be deleted', async () => {
    const kind = await createKind(f.db, manager, { name: `InUse ${f.tag}` });
    await createItem(f.db, manager, input({ kindId: kind.id }));
    await expect(deleteKind(f.db, manager, kind.id)).rejects.toBeInstanceOf(ConflictError);
    await setKindActive(f.db, manager, kind.id, kind.row_version, false);
    await expect(createItem(f.db, manager, input({ kindId: kind.id }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const spare = await createKind(f.db, manager, { name: `Spare ${f.tag}` });
    await deleteKind(f.db, manager, spare.id);
    await expect(getKind(f.db, manager, spare.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('carries how long its kit is usually out for, offered as the due-back date (K33)', async () => {
    const kind = await createKind(f.db, manager, { name: `Days ${f.tag}` });
    expect(kind.default_days_out).toBeNull();
    const updated = await updateKind(f.db, manager, kind.id, kind.row_version, {
      name: kind.name,
      defaultDaysOut: '14',
    });
    expect(updated.default_days_out).toBe(14);
    await expect(
      updateKind(f.db, manager, kind.id, updated.row_version, {
        name: kind.name,
        defaultDaysOut: 'a fortnight',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('item register (S2-2)', () => {
  it('generates asset numbers from the kind prefix and never repeats one; a typed number is kept', async () => {
    const a = await createItem(f.db, manager, input());
    const b = await createItem(f.db, manager, input());
    expect(a.asset_number).toMatch(/^LD-\d{6}$/);
    expect(b.asset_number).toMatch(/^LD-\d{6}$/);
    expect(b.asset_number).not.toBe(a.asset_number);
    const typed = await createItem(f.db, manager, input({ assetNumber: `my-${f.tag}-1` }));
    expect(typed.asset_number).toBe(`MY-${f.tag}-1`);
    await expect(
      createItem(f.db, manager, input({ assetNumber: `MY-${f.tag}-1` })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createItem(f.db, manager, input({ assetNumber: 'bad number!' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps cost in exact pence and checks the hire details', async () => {
    const item = await createItem(
      f.db,
      manager,
      input({ cost: '£1,234.56', purchaseDate: '2025-03-04' }),
    );
    expect(Number(item.cost_pence)).toBe(123456);
    await expect(createItem(f.db, manager, input({ cost: '12.345' }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createItem(f.db, manager, input({ ownership: 'hired_in' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createItem(f.db, manager, input({ hireCompany: 'Example Hire Ltd' })),
    ).rejects.toBeInstanceOf(ValidationError);
    const hired = await createItem(
      f.db,
      manager,
      input({
        ownership: 'hired_in',
        hireCompany: 'Example Hire Ltd',
        hireReference: 'H-9',
        offHireDate: '2027-01-31',
      }),
    );
    expect(hired).toMatchObject({
      ownership: 'hired_in',
      hire_company: 'Example Hire Ltd',
      off_hire_date: '2027-01-31',
    });
  });

  it('who may do what: operatives and viewers only look; supervisors edit but do not create or retire', async () => {
    await expect(createItem(f.db, operative, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createItem(f.db, viewer, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createItem(f.db, supervisor, input())).rejects.toBeInstanceOf(ForbiddenError);
    const item = await createItem(f.db, manager, input());
    expect((await getItem(f.db, operative, item.id)).item.id).toBe(item.id);
    await expect(
      updateItem(f.db, operative, item.id, item.row_version, input()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const edited = await updateItem(
      f.db,
      supervisor,
      item.id,
      item.row_version,
      input({ make: 'Examplo' }),
    );
    expect(edited.make).toBe('Examplo');
    await expect(
      retireItem(f.db, supervisor, item.id, edited.row_version, 'Scrapped'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a stale edit (optimistic locking) and an edit that moves the item to another depot', async () => {
    const item = await createItem(f.db, manager, input());
    await updateItem(f.db, manager, item.id, item.row_version, input({ notes: 'first' }));
    await expect(
      updateItem(f.db, manager, item.id, item.row_version, input({ notes: 'second' })),
    ).rejects.toBeInstanceOf(ConflictError);
    const manyDepots = await f.actor(
      (await f.user({ roles: ['kit_manager'], siteIds: [siteA, siteB] })).id,
    );
    const fresh = await getItem(f.db, manyDepots, item.id);
    await expect(
      updateItem(f.db, manyDepots, item.id, fresh.item.row_version, input({ siteId: siteB })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('retires with a reason and keeps the item; a retired item can’t be edited', async () => {
    const item = await createItem(f.db, manager, input());
    await expect(retireItem(f.db, manager, item.id, item.row_version, '  ')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await retireItem(f.db, manager, item.id, item.row_version, 'Failed beyond repair');
    const after = await getItem(f.db, manager, item.id);
    expect(after.item).toMatchObject({ status: 'retired', retired_reason: 'Failed beyond repair' });
    await expect(
      updateItem(f.db, manager, item.id, after.item.row_version, input()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('records history in the audit log, visible to anyone who can see the item', async () => {
    const item = await createItem(f.db, manager, input());
    await updateItem(f.db, manager, item.id, item.row_version, input({ make: 'Audited' }));
    const history = await itemHistory(f.db, viewer, item.id);
    expect(history.map((e) => e.action)).toEqual([
      'register.items.update',
      'register.items.create',
    ]);
    expect((history[0]!.after as { make: string }).make).toBe('Audited');
  });
});

describe('kit sets (S2-2)', () => {
  it('holds items one level deep and shows its contents', async () => {
    const kit = await createItem(f.db, manager, input({ isKit: true, description: 'Harness set' }));
    const a = await createItem(f.db, manager, input());
    const b = await createItem(f.db, manager, input());
    await setItemKit(f.db, supervisor, a.id, kit.id);
    await setItemKit(f.db, supervisor, b.id, kit.id);
    const detail = await getItem(f.db, manager, kit.id);
    expect(detail.parts.map((p) => p.assetNumber).sort()).toEqual(
      [a.asset_number, b.asset_number].sort(),
    );
    expect((await getItem(f.db, manager, a.id)).kit?.assetNumber).toBe(kit.asset_number);
    expect((await listKits(f.db, manager, siteA)).map((k) => k.id)).toContain(kit.id);
    // Not a kit, and not inside a kit.
    await expect(setItemKit(f.db, manager, b.id, a.id)).rejects.toBeInstanceOf(ValidationError);
    const other = await createItem(f.db, manager, input({ isKit: true }));
    await expect(setItemKit(f.db, manager, other.id, kit.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A kit with items can't be retired; taking them out first allows it.
    await expect(
      retireItem(f.db, manager, kit.id, detail.item.row_version, 'Scrapped'),
    ).rejects.toBeInstanceOf(ValidationError);
    await setItemKit(f.db, manager, a.id, null);
    await setItemKit(f.db, manager, b.id, null);
    const emptied = await getItem(f.db, manager, kit.id);
    await retireItem(f.db, manager, kit.id, emptied.item.row_version, 'Scrapped');
  });
});

describe('list, filters, paging and export', () => {
  it('searches, filters by kind, status, ownership and kit, and pages', async () => {
    const tag = f.tag.toLowerCase();
    for (let i = 0; i < 7; i++)
      await createItem(f.db, manager, input({ make: `Pager${tag}`, model: `M${i}` }));
    const hired = await createItem(
      f.db,
      manager,
      input({ make: `Pager${tag}`, ownership: 'hired_in', hireCompany: 'Example Hire Ltd' }),
    );
    const page1 = await listItems(f.db, viewer, { q: `pager${tag}`, pageSize: 3 });
    expect(page1.total).toBe(8);
    expect(page1.pages).toBe(3);
    expect(page1.rows).toHaveLength(3);
    const page3 = await listItems(f.db, viewer, { q: `pager${tag}`, pageSize: 3, page: 3 });
    expect(page3.rows).toHaveLength(2);
    expect(
      (await listItems(f.db, viewer, { q: `pager${tag}`, ownership: 'hired_in' })).rows.map(
        (r) => r.id,
      ),
    ).toEqual([hired.id]);
    expect((await listItems(f.db, viewer, { q: `pager${tag}`, status: 'retired' })).total).toBe(0);
    expect((await listItems(f.db, viewer, { q: `pager${tag}`, kindId })).total).toBe(8);
    expect((await listItems(f.db, viewer, { q: `pager${tag}`, siteId: siteB })).total).toBe(0);
    // A search with wildcard characters is taken literally.
    expect((await listItems(f.db, viewer, { q: '%' })).total).toBe(0);
  });

  it('exports the filtered list as a formula-safe CSV of everything that matches', async () => {
    const tag = f.tag.toLowerCase();
    await createItem(
      f.db,
      manager,
      input({ make: `Csv${tag}`, description: '=HYPERLINK("http://x")', cost: '12.50' }),
    );
    const csv = await exportItemsCsv(f.db, viewer, { q: `csv${tag}` });
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^asset_number,kind,depot,status,/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain('12.50');
  });
});

describe('site isolation through the services (A1, A21)', () => {
  it('shows a depot B item to nobody at depot A, in lists, by id, exports and history', async () => {
    const secret = await createItem(f.db, atB, { siteId: siteB, kindId, make: `Hidden${f.tag}` });
    expect((await listItems(f.db, manager, { q: `hidden${f.tag}` })).total).toBe(0);
    await expect(getItem(f.db, manager, secret.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await itemHistory(f.db, manager, secret.id)).toEqual([]);
    expect(await exportItemsCsv(f.db, manager, { q: `hidden${f.tag}` })).not.toContain('Hidden');
    await expect(createItem(f.db, manager, { siteId: siteB, kindId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateItem(f.db, manager, secret.id, secret.row_version, { siteId: siteB, kindId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setItemKit(f.db, manager, secret.id, null)).rejects.toBeInstanceOf(NotFoundError);
  });
});
