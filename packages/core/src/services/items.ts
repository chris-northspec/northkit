import {
  ITEM_STATUSES,
  sql,
  withScope,
  type AuditEvent,
  type Db,
  type Item,
  type ItemPhoto,
  type ItemStatus,
  type Tx,
} from '@northkit/db';
import { z } from 'zod';
import { can, requirePermission, requireSite, scopeOf, type ActorContext } from '../context';
import { penceToPounds, poundsToPence } from '../decimal';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { toReportCsv } from './csv';
import { getSetting } from './settings';
import { isUniqueViolation, parse } from './validation';

// The item register (S2-2, IT-1 to IT-3). Sprint 2 sets only 'available' and 'retired';
// out, quarantined and missing are set by Sprints 3 and 4, and the database already
// enforces which status can follow which (migration 0005). An item belongs to one depot
// (its home), may be in one location of that depot, and may be part of a kit one level
// deep.

export { ITEM_STATUSES };
export type { ItemStatus };

export const STATUS_LABELS: Record<ItemStatus, string> = {
  available: 'Available',
  out: 'Out',
  quarantined: 'Quarantined',
  missing: 'Missing',
  retired: 'Retired',
};

export const ASSET_NUMBER = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max.toLocaleString('en-GB')} characters or fewer.`)
    .transform((v) => v || null)
    .nullable()
    .default(null);

/** yyyy-mm-dd that is a real calendar day (not 31 February). */
function realDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || realDate(v), 'Enter a real date, as day, month and year.')
  .transform((v) => v || null)
  .nullable()
  .default(null);

/** £ as typed ("12.50", "£1,200") to whole pence, or null for blank. */
const optionalCost = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null;
    const pence = poundsToPence(v.replace(/^£/, '').replace(/,/g, ''));
    if (pence === null || pence < 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount in pounds, such as 12.50.' });
      return z.NEVER;
    }
    return pence;
  })
  .nullable()
  .default(null);

export const itemInputSchema = z
  .object({
    siteId: z.string().uuid('Choose a depot.'),
    kindId: z.string().uuid('Choose a kind.'),
    assetNumber: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (v) => v === '' || ASSET_NUMBER.test(v),
        'Use up to 30 letters, digits, dots, slashes or hyphens.',
      )
      .default(''),
    serialNumber: optionalText(100),
    make: optionalText(100),
    model: optionalText(100),
    description: optionalText(1000),
    purchaseDate: optionalDate,
    cost: optionalCost,
    ownership: z
      .enum(['owned', 'hired_in'], { message: 'Choose owned or hired in.' })
      .default('owned'),
    hireCompany: optionalText(200),
    hireReference: optionalText(100),
    offHireDate: optionalDate,
    locationId: z.string().uuid().nullable().default(null),
    isKit: z.boolean().default(false),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.ownership === 'hired_in' && !v.hireCompany)
      ctx.addIssue({
        code: 'custom',
        path: ['hireCompany'],
        message: 'Enter the company it is hired from.',
      });
    if (v.ownership === 'owned' && (v.hireCompany || v.hireReference || v.offHireDate))
      ctx.addIssue({
        code: 'custom',
        path: ['ownership'],
        message: 'Hire details are only for hired-in kit: choose hired in, or clear them.',
      });
  });
export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemValues = z.output<typeof itemInputSchema>;

export interface ItemFilters {
  q?: string;
  kindId?: string;
  siteId?: string;
  status?: ItemStatus;
  ownership?: 'owned' | 'hired_in';
  /** Only kits, or only items in kits. */
  kits?: 'kits' | 'in_kit';
  page?: number;
  pageSize?: number;
}

export const ITEMS_PAGE_SIZE = 25;
export const ITEMS_EXPORT_LIMIT = 50_000;

export interface ItemListRow {
  id: string;
  siteId: string;
  siteCode: string;
  assetNumber: string;
  kindId: string;
  kindName: string;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  status: ItemStatus;
  ownership: 'owned' | 'hired_in';
  locationCode: string | null;
  isKit: boolean;
  kitAssetNumber: string | null;
  /** Items in the kit, for a kit. */
  partCount: number;
  /** The first photo, for a thumbnail; null if none. */
  photoId: string | null;
  photoHasThumb: boolean;
}

function baseQuery(tx: Tx, f: ItemFilters) {
  let q = tx
    .selectFrom('register.items as i')
    .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
    .innerJoin('core.sites as s', 's.id', 'i.site_id')
    .leftJoin('core.locations as l', 'l.id', 'i.location_id')
    .leftJoin('register.items as p', 'p.id', 'i.parent_id');
  const search = f.q?.trim();
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    q = q.where((eb) =>
      eb.or([
        eb('i.asset_number', 'ilike', like),
        eb('i.serial_number', 'ilike', like),
        eb('i.make', 'ilike', like),
        eb('i.model', 'ilike', like),
        eb('i.description', 'ilike', like),
        eb('i.hire_reference', 'ilike', like),
      ]),
    );
  }
  if (f.kindId) q = q.where('i.kind_id', '=', f.kindId);
  if (f.siteId) q = q.where('i.site_id', '=', f.siteId);
  if (f.status) q = q.where('i.status', '=', f.status);
  if (f.ownership) q = q.where('i.ownership', '=', f.ownership);
  if (f.kits === 'kits') q = q.where('i.is_kit', '=', true);
  if (f.kits === 'in_kit') q = q.where('i.parent_id', 'is not', null);
  return q;
}

function selectRows(tx: Tx, f: ItemFilters) {
  return baseQuery(tx, f).select([
    'i.id',
    'i.site_id as siteId',
    's.code as siteCode',
    'i.asset_number as assetNumber',
    'i.kind_id as kindId',
    'k.name as kindName',
    'i.make',
    'i.model',
    'i.serial_number as serialNumber',
    'i.status',
    'i.ownership',
    'l.code as locationCode',
    'i.is_kit as isKit',
    'p.asset_number as kitAssetNumber',
    sql<number>`(SELECT count(*) FROM register.items c WHERE c.parent_id = i.id)::int`.as(
      'partCount',
    ),
    sql<
      string | null
    >`(SELECT ph.id FROM register.item_photos ph WHERE ph.item_id = i.id ORDER BY ph.sort_order, ph.created_at LIMIT 1)`.as(
      'photoId',
    ),
    sql<boolean>`coalesce((SELECT ph.thumb_key IS NOT NULL FROM register.item_photos ph WHERE ph.item_id = i.id ORDER BY ph.sort_order, ph.created_at LIMIT 1), false)`.as(
      'photoHasThumb',
    ),
  ]);
}

/** One page of items the actor can see, with the total for paging. */
export async function listItems(
  db: Db,
  actor: ActorContext,
  filters: ItemFilters = {},
): Promise<{ rows: ItemListRow[]; total: number; page: number; pageSize: number; pages: number }> {
  requirePermission(actor, 'items.view');
  const pageSize = Math.min(Math.max(filters.pageSize ?? ITEMS_PAGE_SIZE, 1), 100);
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const { n } = await baseQuery(tx, filters)
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirstOrThrow();
    const pages = Math.max(1, Math.ceil(n / pageSize));
    const page = Math.min(Math.max(filters.page ?? 1, 1), pages);
    const rows = await selectRows(tx, filters)
      .orderBy('i.asset_number')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    return { rows, total: n, page, pageSize, pages };
  });
}

export interface ItemDetail {
  item: Item;
  kindName: string;
  kindActive: boolean;
  siteCode: string;
  siteName: string;
  locationCode: string | null;
  locationName: string | null;
  kit: { id: string; assetNumber: string; kindName: string } | null;
  parts: ItemListRow[];
  photos: ItemPhoto[];
}

export async function getItem(db: Db, actor: ActorContext, id: string): Promise<ItemDetail> {
  requirePermission(actor, 'items.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const row = await tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .innerJoin('core.sites as s', 's.id', 'i.site_id')
      .leftJoin('core.locations as l', 'l.id', 'i.location_id')
      .selectAll('i')
      .select([
        'k.name as kindName',
        'k.active as kindActive',
        's.code as siteCode',
        's.name as siteName',
        'l.code as locationCode',
        'l.name as locationName',
      ])
      .where('i.id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Item not found.');
    const { kindName, kindActive, siteCode, siteName, locationCode, locationName, ...item } = row;
    const kit = item.parent_id
      ? await tx
          .selectFrom('register.items as p')
          .innerJoin('register.kinds as k', 'k.id', 'p.kind_id')
          .select(['p.id', 'p.asset_number as assetNumber', 'k.name as kindName'])
          .where('p.id', '=', item.parent_id)
          .executeTakeFirst()
      : undefined;
    const parts = item.is_kit
      ? await selectRows(tx, {}).where('i.parent_id', '=', id).orderBy('i.asset_number').execute()
      : [];
    const photos = await tx
      .selectFrom('register.item_photos')
      .selectAll()
      .where('item_id', '=', id)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    return {
      item: item as Item,
      kindName,
      kindActive,
      siteCode,
      siteName,
      locationCode,
      locationName,
      kit: kit ?? null,
      parts,
      photos,
    };
  });
}

/** What happened to an item, from the audit log (the people with access to the depot see it). */
export async function itemHistory(
  db: Db,
  actor: ActorContext,
  id: string,
  limit = 50,
): Promise<AuditEvent[]> {
  requirePermission(actor, 'items.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx
      .selectFrom('audit.audit_events')
      .selectAll()
      .where('entity_type', 'in', ['register.items', 'register.item_photos'])
      .where((eb) =>
        eb.or([
          eb('entity_id', '=', id),
          eb(sql<string>`coalesce(after ->> 'item_id', before ->> 'item_id')`, '=', id),
        ]),
      )
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute(),
  );
}

function itemError(error: unknown): never {
  const e = error as { code?: string; constraint?: string; message?: string } | null;
  if (isUniqueViolation(error)) {
    if (e?.constraint === 'items_asset_number_unique')
      throw new ConflictError('That asset number is already used by another item.');
    throw new ConflictError('That value is already used.');
  }
  switch (e?.constraint) {
    case 'items_kind_active':
      throw new ValidationError('That kind is deactivated.', { kindId: 'Choose an active kind.' });
    case 'items_hire_details':
      throw new ValidationError('Check the hire details.', {
        hireCompany: 'Hire details go with hired-in kit, and need the company.',
      });
    case 'items_parent_is_kit':
      throw new ValidationError('Items can only be put in a kit.');
    case 'items_kit_not_child':
      throw new ValidationError('A kit can’t be inside another kit.');
    case 'items_kit_has_items':
      throw new ValidationError(
        'Take the items out of this kit before turning it into a single item.',
      );
    case 'items_retire_kit_with_items':
      throw new ValidationError('Take the items out of this kit before retiring it.');
    case 'items_status_transition':
      throw new ValidationError('That change of status isn’t allowed.');
  }
  if (e?.code === '23503')
    throw new ValidationError('Check the highlighted fields.', {
      locationId: 'Choose a location at the same depot as the item.',
    });
  throw error;
}

const toRow = (v: ItemValues) => ({
  kind_id: v.kindId,
  serial_number: v.serialNumber,
  make: v.make,
  model: v.model,
  description: v.description,
  purchase_date: v.purchaseDate,
  cost_pence: v.cost,
  ownership: v.ownership,
  hire_company: v.ownership === 'hired_in' ? v.hireCompany : null,
  hire_reference: v.ownership === 'hired_in' ? v.hireReference : null,
  off_hire_date: v.ownership === 'hired_in' ? v.offHireDate : null,
  location_id: v.locationId,
  is_kit: v.isKit,
  notes: v.notes,
});

/** The asset number to use: the one typed in, or the next generated one for the kind's prefix. */
export async function nextAssetNumber(tx: Tx, db: Db, kindId: string): Promise<string> {
  const kind = await tx
    .selectFrom('register.kinds')
    .select('asset_prefix')
    .where('id', '=', kindId)
    .executeTakeFirst();
  if (!kind)
    throw new ValidationError('Check the highlighted fields.', { kindId: 'Choose a kind.' });
  const prefix = kind.asset_prefix ?? (await getSetting(db, 'items.asset_number_prefix'));
  const { rows } = await sql<{
    n: string;
  }>`SELECT register.next_asset_number(${prefix}) AS n`.execute(tx);
  return rows[0]!.n;
}

export async function createItem(db: Db, actor: ActorContext, input: ItemInput): Promise<Item> {
  requirePermission(actor, 'items.create');
  const v = parse(itemInputSchema, input);
  requireSite(actor, v.siteId);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const assetNumber = v.assetNumber || (await nextAssetNumber(tx, db, v.kindId));
      return tx
        .insertInto('register.items')
        .values({ site_id: v.siteId, asset_number: assetNumber, status: 'available', ...toRow(v) })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    itemError(error);
  }
}

/** Edits an item. Its home depot and asset number don't change here (a move between depots is a transfer, Sprint 3). */
export async function updateItem(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  input: ItemInput,
): Promise<Item> {
  requirePermission(actor, 'items.edit');
  const v = parse(itemInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const current = await tx
        .selectFrom('register.items')
        .select(['site_id', 'status'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundError('Item not found.');
      if (current.status === 'retired') throw new ConflictError('A retired item can’t be edited.');
      if (current.site_id !== v.siteId)
        throw new ValidationError('Check the highlighted fields.', {
          siteId: 'An item stays at its home depot; moving it is a transfer.',
        });
      const row = await tx
        .updateTable('register.items')
        .set({ ...toRow(v), ...(v.assetNumber ? { asset_number: v.assetNumber } : {}) })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new ConflictError('Someone else changed this item. Reload and try again.');
      return row;
    });
  } catch (error) {
    itemError(error);
  }
}

/** Retire an item (never deleted). Needs a reason, and items.approve. */
export async function retireItem(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  reason: string,
): Promise<void> {
  requirePermission(actor, 'items.approve');
  const text = reason.trim();
  if (!text)
    throw new ValidationError('Say why the item is being retired.', { reason: 'Enter a reason.' });
  if (text.length > 500)
    throw new ValidationError('Use 500 characters or fewer.', {
      reason: 'Use 500 characters or fewer.',
    });
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      const current = await tx
        .selectFrom('register.items')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundError('Item not found.');
      if (current.status !== 'available')
        throw new ConflictError(
          'Only an available item can be retired here. Bring it back in first.',
        );
      const r = await tx
        .updateTable('register.items')
        .set({ status: 'retired', retired_at: new Date(), retired_reason: text, parent_id: null })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .executeTakeFirst();
      if (r.numUpdatedRows === 0n)
        throw new ConflictError('Someone else changed this item. Reload and try again.');
    });
  } catch (error) {
    itemError(error);
  }
}

/** Puts an item in a kit at the same depot, or takes it out (kitId null). */
export async function setItemKit(
  db: Db,
  actor: ActorContext,
  id: string,
  kitId: string | null,
): Promise<void> {
  requirePermission(actor, 'items.edit');
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      const r = await tx
        .updateTable('register.items')
        .set({ parent_id: kitId })
        .where('id', '=', id)
        .where('status', '<>', 'retired')
        .executeTakeFirst();
      if (r.numUpdatedRows === 0n) throw new NotFoundError('Item not found.');
    });
  } catch (error) {
    itemError(error);
  }
}

/** Kits at a depot an item could be added to, for the picker. */
export async function listKits(
  db: Db,
  actor: ActorContext,
  siteId: string,
): Promise<{ id: string; assetNumber: string; kindName: string }[]> {
  requirePermission(actor, 'items.view');
  requireSite(actor, siteId);
  return withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .select(['i.id', 'i.asset_number as assetNumber', 'k.name as kindName'])
      .where('i.site_id', '=', siteId)
      .where('i.is_kit', '=', true)
      .where('i.status', '<>', 'retired')
      .orderBy('i.asset_number')
      .execute(),
  );
}

/** The filtered list as a CSV for a spreadsheet (formula-safe). Exports everything that matches, not one page. */
export async function exportItemsCsv(
  db: Db,
  actor: ActorContext,
  filters: ItemFilters = {},
): Promise<string> {
  requirePermission(actor, 'items.view');
  const rows = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    baseQuery(tx, filters)
      .select([
        'i.asset_number',
        'k.name as kind',
        's.code as depot',
        'i.status',
        'i.serial_number',
        'i.make',
        'i.model',
        'i.description',
        'i.purchase_date',
        'i.cost_pence',
        'i.ownership',
        'i.hire_company',
        'i.hire_reference',
        'i.off_hire_date',
        'l.code as location',
        'p.asset_number as kit',
        'i.retired_reason',
        'i.notes',
      ])
      .orderBy('i.asset_number')
      .limit(ITEMS_EXPORT_LIMIT)
      .execute(),
  );
  return toReportCsv([
    [
      'asset_number',
      'kind',
      'depot',
      'status',
      'serial_number',
      'make',
      'model',
      'description',
      'purchase_date',
      'cost',
      'ownership',
      'hire_company',
      'hire_reference',
      'off_hire_date',
      'location',
      'kit_asset_number',
      'retired_reason',
      'notes',
    ],
    ...rows.map((r) => [
      r.asset_number,
      r.kind,
      r.depot,
      r.status,
      r.serial_number,
      r.make,
      r.model,
      r.description,
      r.purchase_date,
      r.cost_pence === null ? '' : penceToPounds(Number(r.cost_pence)),
      r.ownership === 'hired_in' ? 'hired in' : 'owned',
      r.hire_company,
      r.hire_reference,
      r.off_hire_date,
      r.location,
      r.kit,
      r.retired_reason,
      r.notes,
    ]),
  ]);
}

/** True if the actor may change items at all (to hide buttons; the services check again). */
export function canEditItems(actor: ActorContext): boolean {
  return can(actor, 'items.edit');
}
