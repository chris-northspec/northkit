import { sql, withScope, type Db, type ItemStatus, type MovementType, type Tx } from '@northkit/db';
import { z } from 'zod';
import { can, requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { getSetting } from './settings';
import { parse } from './validation';

// Where kit is and who has it (S3-2, CO-1, CO-4). A movement is evidence: it is inserted,
// never updated, and inserting it is what changes the item's status, holder and location
// (the trigger in migration 0006), so the two can't differ. The rules about WHAT may move
// live in the database; this file adds WHO may do it (K21, K37) and says what went wrong in
// words. Every failure here carries the database's own sentence, so a screen, an email and
// an offline phone all say the same thing.

/** How far back a phone's clock can put a movement (its month's partition must exist). */
export const MAX_OFFLINE_DAYS = 120;
const SKEW_MS = 5 * 60_000;

export const DESTINATION_KINDS = ['me', 'my_van', 'site', 'store', 'person'] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_LABELS: Record<DestinationKind, string> = {
  me: 'To me',
  my_van: 'To my van',
  site: 'To a site',
  store: 'To a store',
  person: 'To a person',
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  check_out: 'Checked out',
  check_in: 'Checked in',
  move: 'Moved',
  missing: 'Reported missing',
  found: 'Found',
  transfer_out: 'Sent to another depot',
  transfer_in: 'Received from another depot',
  transfer_cancel: 'Transfer cancelled',
};

const uuid = z.string().uuid();
const note = z
  .string()
  .trim()
  .max(1000, 'Use 1,000 characters or fewer.')
  .transform((v) => v || null)
  .nullable()
  .default(null);
const clientId = uuid.optional();
const occurredAt = z
  .string()
  .optional()
  .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'That time isn’t valid.');
const dueBack = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v),
    'Enter the date as day, month and year.',
  )
  .transform((v) => v || null)
  .nullable()
  .default(null);

export const checkOutSchema = z.object({
  clientId,
  itemId: uuid,
  /** me | my_van | site | store | person, with the place or person chosen for the last three. */
  destination: z.object({
    kind: z.enum(DESTINATION_KINDS, { message: 'Choose where it is going.' }),
    locationId: uuid.optional(),
    userId: uuid.optional(),
  }),
  dueBackOn: dueBack,
  note,
  occurredAt,
});
export type CheckOutInput = z.input<typeof checkOutSchema>;

export const checkInSchema = z.object({
  clientId,
  itemId: uuid,
  /** Where it is returned to; the depot's store if not given. */
  locationId: uuid.nullable().optional(),
  note,
  occurredAt,
});
export type CheckInInput = z.input<typeof checkInSchema>;

export const missingSchema = z.object({ clientId, itemId: uuid, note, occurredAt });
export type MissingInput = z.input<typeof missingSchema>;

export const foundSchema = z.object({
  clientId,
  itemId: uuid,
  locationId: uuid,
  note,
  occurredAt,
});
export type FoundInput = z.input<typeof foundSchema>;

export interface MovementResult {
  movementId: string;
  itemId: string;
  assetNumber: string;
  status: ItemStatus;
  /** True when this id was recorded before (a phone replaying it): nothing was added. */
  replayed: boolean;
  /** What it says on screen: "FB-000123 checked out to Sam Hart." */
  message: string;
}

/** The database's refusals, in words and with the right kind of error for the caller. */
export function movementError(error: unknown): never {
  const e = error as { code?: string; constraint?: string; message?: string } | null;
  if (e?.code === 'P0002') throw new NotFoundError('Item not found.');
  if (e?.code === '42501') throw new NotFoundError('Item not found.');
  if (e?.code === '23505') throw new ConflictError('That movement has already been recorded.');
  if (e?.code === '23503')
    throw new ValidationError('Check where it is going.', {
      destination: 'Choose a place at this item’s depot.',
    });
  if (
    e?.code === '23514' ||
    e?.constraint?.startsWith('movements_') ||
    e?.constraint?.startsWith('items_')
  )
    throw new ConflictError(e.message ?? 'That can’t be done now.');
  throw error;
}

interface ItemState {
  id: string;
  siteId: string;
  assetNumber: string;
  kindId: string;
  status: ItemStatus;
  holderUserId: string | null;
  locationId: string | null;
  isKit: boolean;
  parentId: string | null;
  defaultDaysOut: number | null;
  timeZone: string;
}

async function itemState(tx: Tx, itemId: string): Promise<ItemState> {
  const row = await tx
    .selectFrom('register.items as i')
    .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
    .innerJoin('core.sites as s', 's.id', 'i.site_id')
    .select([
      'i.id',
      'i.site_id as siteId',
      'i.asset_number as assetNumber',
      'i.kind_id as kindId',
      'i.status',
      'i.holder_user_id as holderUserId',
      'i.location_id as locationId',
      'i.is_kit as isKit',
      'i.parent_id as parentId',
      'k.default_days_out as defaultDaysOut',
      's.time_zone as timeZone',
    ])
    .where('i.id', '=', itemId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Item not found.');
  return row;
}

/** The moment to record: the phone's clock if it sent one (within limits), otherwise now. */
export function recordedAt(input: string | undefined, now = new Date()): Date {
  if (input === undefined) return now;
  const at = new Date(input);
  if (at.getTime() > now.getTime() + SKEW_MS)
    throw new ValidationError('That time is in the future. Check the clock on this phone.');
  if (at.getTime() < now.getTime() - MAX_OFFLINE_DAYS * 86_400_000)
    throw new ValidationError(
      `That was recorded more than ${MAX_OFFLINE_DAYS} days ago, which is too long to send as it stands. Ask a Kit Manager to record it.`,
    );
  return at;
}

async function alreadyRecorded(
  tx: Tx,
  actor: ActorContext,
  id: string | undefined,
  itemId: string,
): Promise<{ movementId: string; toStatus: ItemStatus } | null> {
  if (!id) return null;
  const row = await tx
    .selectFrom('movements.movements')
    .select(['id', 'item_id', 'created_by', 'to_status'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  // A different item or person under the same id is a clash, not a replay.
  if (row.item_id !== itemId || row.created_by !== actor.userId)
    throw new ConflictError('That movement id has already been used.');
  return { movementId: row.id, toStatus: row.to_status };
}

interface Row {
  type: MovementType;
  at: Date;
  toUserId?: string | null;
  toLocationId?: string | null;
  dueBackOn?: string | null;
  note?: string | null;
  transferId?: string | null;
  siteId?: string;
  clientId?: string;
}

async function record(
  tx: Tx,
  item: ItemState,
  r: Row,
): Promise<{ id: string; toStatus: ItemStatus }> {
  try {
    const row = await tx
      .insertInto('movements.movements')
      .values({
        ...(r.clientId ? { id: r.clientId } : {}),
        site_id: r.siteId ?? item.siteId,
        item_id: item.id,
        movement_type: r.type,
        to_user_id: r.toUserId ?? null,
        to_location_id: r.toLocationId ?? null,
        due_back_on: r.dueBackOn ?? null,
        note: r.note ?? null,
        transfer_id: r.transferId ?? null,
        occurred_at: r.at,
      })
      .returning(['id', 'to_status'])
      .executeTakeFirstOrThrow();
    return { id: row.id, toStatus: row.to_status };
  } catch (error) {
    return movementError(error);
  }
}

interface PlaceInfo {
  id: string;
  siteId: string;
  kind: 'site' | 'van' | 'store' | 'yard';
  code: string;
  name: string;
  assignedUserId: string | null;
  archived: boolean;
}

async function placeInfo(tx: Tx, id: string): Promise<PlaceInfo> {
  const row = await tx
    .selectFrom('core.locations')
    .select([
      'id',
      'site_id as siteId',
      'kind',
      'code',
      'name',
      'assigned_user_id as assignedUserId',
      'archived_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row)
    throw new ValidationError('Check where it is going.', {
      destination: 'That place wasn’t found.',
    });
  return { ...row, archived: row.archived_at !== null };
}

async function personName(tx: Tx, userId: string): Promise<string> {
  const row = await tx
    .selectFrom('core.users')
    .select(['display_name', 'archived_at'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!row || row.archived_at)
    throw new ValidationError('Check where it is going.', {
      destination: 'That person wasn’t found.',
    });
  return row.display_name;
}

/** The depot's own store: where kit is returned to unless the person says otherwise. */
async function homeStore(tx: Tx, siteId: string): Promise<string | null> {
  const row = await tx
    .selectFrom('core.locations')
    .select('id')
    .where('site_id', '=', siteId)
    .where('kind', '=', 'store')
    .where('archived_at', 'is', null)
    .orderBy('parent_id', sql`asc nulls first`)
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? null;
}

/** May this person be handed kit at this depot? Anyone with access, unless the actor may do anything (K37). */
async function personHasDepot(tx: Tx, userId: string, siteId: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    SELECT ${siteId}::uuid = ANY (core.accessible_site_ids(${userId}::uuid)) AS ok`.execute(tx);
  return rows[0]?.ok === true;
}

const OWN_ONLY =
  'You can check kit out to yourself and to your own van. Ask a Supervisor for anything else.';

async function resolveDestination(
  tx: Tx,
  actor: ActorContext,
  item: ItemState,
  d: { kind: DestinationKind; locationId?: string; userId?: string },
): Promise<{ toUserId: string | null; toLocationId: string | null; label: string }> {
  const anyone = can(actor, 'checkouts.edit');
  if (d.kind === 'me') {
    return { toUserId: actor.userId, toLocationId: null, label: 'you' };
  }
  if (d.kind === 'my_van') {
    const vans = await tx
      .selectFrom('core.locations')
      .select(['id', 'name', 'code'])
      .where('site_id', '=', item.siteId)
      .where('kind', '=', 'van')
      .where('assigned_user_id', '=', actor.userId)
      .where('archived_at', 'is', null)
      .orderBy('code')
      .execute();
    const van = d.locationId ? vans.find((v) => v.id === d.locationId) : vans[0];
    if (!van)
      throw new ValidationError('You don’t have a van at this depot.', {
        destination:
          'No van here is assigned to you. Ask a Kit Manager to set it on the depot’s locations, or choose another place.',
      });
    return { toUserId: null, toLocationId: van.id, label: van.name };
  }
  if (d.kind === 'person') {
    if (!d.userId)
      throw new ValidationError('Choose a person.', { destination: 'Choose a person.' });
    if (d.userId !== actor.userId && !anyone) throw new ForbiddenError(OWN_ONLY);
    const name = await personName(tx, d.userId);
    if (
      d.userId !== actor.userId &&
      !can(actor, 'checkouts.approve') &&
      !(await personHasDepot(tx, d.userId, item.siteId))
    )
      throw new ValidationError('That person doesn’t work at this depot.', {
        destination: 'Choose someone who works at this depot.',
      });
    return {
      toUserId: d.userId,
      toLocationId: null,
      label: d.userId === actor.userId ? 'you' : name,
    };
  }
  // site | store: a place at the depot.
  if (!d.locationId)
    throw new ValidationError('Choose a place.', { destination: 'Choose a place.' });
  const place = await placeInfo(tx, d.locationId);
  if (place.siteId !== item.siteId)
    throw new ValidationError('Check where it is going.', {
      destination:
        'Choose a place at this item’s depot. Moving kit to another depot is a transfer.',
    });
  if (place.archived)
    throw new ValidationError('Check where it is going.', {
      destination: `${place.name} is archived.`,
    });
  if (!anyone && !(place.kind === 'van' && place.assignedUserId === actor.userId))
    throw new ForbiddenError(OWN_ONLY);
  return { toUserId: null, toLocationId: place.id, label: place.name };
}

/** The due-back date to offer: today in the depot's time zone plus the kind's days (or the organisation's). */
export async function suggestedDueBack(
  db: Db,
  actor: ActorContext,
  itemIds: readonly string[],
  now = new Date(),
): Promise<string | null> {
  requirePermission(actor, 'checkouts.view');
  const fallback = await getSetting(db, 'checkout.default_days_out');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let longest = 0;
    let zone = 'Europe/London';
    for (const id of itemIds) {
      const item = await itemState(tx, id);
      zone = item.timeZone;
      longest = Math.max(longest, item.defaultDaysOut ?? fallback);
    }
    if (!itemIds.length) return null;
    return addDays(today(now, zone), longest);
  });
}

/** Today's date (yyyy-mm-dd) in a time zone. */
export function today(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Checks one item out. Idempotent on `clientId`. */
export async function checkOut(
  db: Db,
  actor: ActorContext,
  input: CheckOutInput,
): Promise<MovementResult> {
  requirePermission(actor, 'checkouts.create');
  const v = parse(checkOutSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), (tx) => checkOutIn(tx, actor, v, at));
}

async function checkOutIn(
  tx: Tx,
  actor: ActorContext,
  v: z.output<typeof checkOutSchema>,
  at: Date,
): Promise<MovementResult> {
  const item = await itemState(tx, v.itemId);
  const again = await alreadyRecorded(tx, actor, v.clientId, item.id);
  if (again)
    return {
      movementId: again.movementId,
      itemId: item.id,
      assetNumber: item.assetNumber,
      status: again.toStatus,
      replayed: true,
      message: `${item.assetNumber} was already recorded.`,
    };
  const dest = await resolveDestination(tx, actor, item, v.destination);
  const r = await record(tx, item, {
    clientId: v.clientId,
    type: 'check_out',
    at,
    toUserId: dest.toUserId,
    toLocationId: dest.toLocationId,
    dueBackOn: v.dueBackOn,
    note: v.note,
  });
  return {
    movementId: r.id,
    itemId: item.id,
    assetNumber: item.assetNumber,
    status: r.toStatus,
    replayed: false,
    message: `${item.assetNumber} ${r.toStatus === 'out' ? 'checked out to' : 'moved to'} ${dest.label}.`,
  };
}

export interface BulkResult {
  done: MovementResult[];
  refused: { itemId: string; assetNumber: string | null; reason: string }[];
}

/**
 * Checks several items out to one destination. Each is its own unit (a savepoint), so one
 * that can't go doesn't stop the rest, and each refusal says why.
 */
export async function checkOutMany(
  db: Db,
  actor: ActorContext,
  input: {
    itemIds: string[];
    destination: CheckOutInput['destination'];
    dueBackOn?: string | null;
    note?: string | null;
  },
): Promise<BulkResult> {
  requirePermission(actor, 'checkouts.create');
  if (!input.itemIds.length) throw new ValidationError('Scan at least one item.');
  if (input.itemIds.length > 200) throw new ValidationError('Check out up to 200 items at a time.');
  return withScope(db, scopeOf(actor), async (tx) => {
    const out: BulkResult = { done: [], refused: [] };
    for (const [i, itemId] of [...new Set(input.itemIds)].entries()) {
      const name = `bulk_${i}`;
      await sql.raw(`SAVEPOINT ${name}`).execute(tx);
      try {
        const v = parse(checkOutSchema, {
          itemId,
          destination: input.destination,
          dueBackOn: input.dueBackOn ?? null,
          note: input.note ?? null,
        });
        out.done.push(await checkOutIn(tx, actor, v, new Date()));
        await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(tx);
      } catch (error) {
        await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(tx);
        if (!(
          error instanceof ConflictError ||
          error instanceof ValidationError ||
          error instanceof NotFoundError ||
          error instanceof ForbiddenError
        ))
          throw error;
        const asset = await tx
          .selectFrom('register.items')
          .select('asset_number')
          .where('id', '=', itemId)
          .executeTakeFirst();
        out.refused.push({
          itemId,
          assetNumber: asset?.asset_number ?? null,
          reason:
            error instanceof ValidationError
              ? (Object.values(error.fields)[0] ?? error.message)
              : error.message,
        });
      }
    }
    return out;
  });
}

/** Checks one item in, to a place (the depot's store if none is given). */
export async function checkIn(
  db: Db,
  actor: ActorContext,
  input: CheckInInput,
): Promise<MovementResult> {
  requirePermission(actor, 'checkouts.create');
  const v = parse(checkInSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const item = await itemState(tx, v.itemId);
    const again = await alreadyRecorded(tx, actor, v.clientId, item.id);
    if (again)
      return {
        movementId: again.movementId,
        itemId: item.id,
        assetNumber: item.assetNumber,
        status: again.toStatus,
        replayed: true,
        message: `${item.assetNumber} was already recorded.`,
      };
    if (!can(actor, 'checkouts.edit')) {
      let mine = item.holderUserId === actor.userId;
      if (!mine && item.locationId)
        mine = (await placeInfo(tx, item.locationId)).assignedUserId === actor.userId;
      if (!mine && item.status === 'out')
        throw new ForbiddenError(
          'You can check in kit you hold or that is in your van. Ask a Supervisor for anything else.',
        );
    }
    const place = v.locationId ?? (await homeStore(tx, item.siteId));
    if (!place)
      throw new ValidationError('Choose where it is going back to.', {
        locationId:
          'This depot has no store yet. Choose a place, or ask a Kit Manager to add a store.',
      });
    const info = await placeInfo(tx, place);
    if (info.siteId !== item.siteId)
      throw new ValidationError('Check where it is going back to.', {
        locationId: 'Choose a place at this item’s depot.',
      });
    const r = await record(tx, item, {
      clientId: v.clientId,
      type: 'check_in',
      at,
      toLocationId: place,
      note: v.note,
    });
    return {
      movementId: r.id,
      itemId: item.id,
      assetNumber: item.assetNumber,
      status: r.toStatus,
      replayed: false,
      message: `${item.assetNumber} checked in to ${info.name}.`,
    };
  });
}

/** Reports an item missing. Anyone who can check kit out may; it goes on the needs-action panel. */
export async function reportMissing(
  db: Db,
  actor: ActorContext,
  input: MissingInput,
): Promise<MovementResult> {
  requirePermission(actor, 'checkouts.create');
  const v = parse(missingSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const item = await itemState(tx, v.itemId);
    const again = await alreadyRecorded(tx, actor, v.clientId, item.id);
    if (again)
      return {
        movementId: again.movementId,
        itemId: item.id,
        assetNumber: item.assetNumber,
        status: again.toStatus,
        replayed: true,
        message: `${item.assetNumber} was already reported.`,
      };
    const r = await record(tx, item, { clientId: v.clientId, type: 'missing', at, note: v.note });
    return {
      movementId: r.id,
      itemId: item.id,
      assetNumber: item.assetNumber,
      status: r.toStatus,
      replayed: false,
      message: `${item.assetNumber} reported missing.`,
    };
  });
}

/** Records a missing item as found, where it was found. Needs a Supervisor or above. */
export async function markFound(
  db: Db,
  actor: ActorContext,
  input: FoundInput,
): Promise<MovementResult> {
  requirePermission(actor, 'checkouts.edit');
  const v = parse(foundSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const item = await itemState(tx, v.itemId);
    const again = await alreadyRecorded(tx, actor, v.clientId, item.id);
    if (again)
      return {
        movementId: again.movementId,
        itemId: item.id,
        assetNumber: item.assetNumber,
        status: again.toStatus,
        replayed: true,
        message: `${item.assetNumber} was already recorded.`,
      };
    const place = await placeInfo(tx, v.locationId);
    if (place.siteId !== item.siteId)
      throw new ValidationError('Check where it was found.', {
        locationId: 'Choose a place at this item’s depot.',
      });
    const r = await record(tx, item, {
      clientId: v.clientId,
      type: 'found',
      at,
      toLocationId: place.id,
      note: v.note,
    });
    return {
      movementId: r.id,
      itemId: item.id,
      assetNumber: item.assetNumber,
      status: r.toStatus,
      replayed: false,
      message: `${item.assetNumber} found at ${place.name}.`,
    };
  });
}

// ---------------------------------------------------------------- what the screens show

export interface MovementRow {
  id: string;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  byName: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  dueBackOn: string | null;
  note: string | null;
  viaKit: string | null;
  /** It reached the server later than it happened: made offline. */
  offline: boolean;
}

/** An item's history of movements, newest first. People at its depot see them. */
export async function itemMovements(
  db: Db,
  actor: ActorContext,
  itemId: string,
  limit = 50,
): Promise<MovementRow[]> {
  requirePermission(actor, 'items.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const rows = await tx
      .selectFrom('movements.movements as m')
      .leftJoin('core.users as by', 'by.id', 'm.created_by')
      .leftJoin('core.users as fu', 'fu.id', 'm.from_user_id')
      .leftJoin('core.users as tu', 'tu.id', 'm.to_user_id')
      .leftJoin('core.locations as fl', 'fl.id', 'm.from_location_id')
      .leftJoin('core.locations as tl', 'tl.id', 'm.to_location_id')
      .leftJoin('register.items as kit', 'kit.id', 'm.via_kit_id')
      .select([
        'm.id',
        'm.movement_type as type',
        'm.occurred_at as occurredAt',
        'm.created_at as recordedAt',
        'by.display_name as byName',
        'fu.display_name as fromUser',
        'fl.name as fromPlace',
        'tu.display_name as toUser',
        'tl.name as toPlace',
        sql<string | null>`to_char(m.due_back_on, 'YYYY-MM-DD')`.as('dueBackOn'),
        'm.note',
        'kit.asset_number as viaKit',
      ])
      .where('m.item_id', '=', itemId)
      .orderBy('m.occurred_at', 'desc')
      .orderBy('m.created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      occurredAt: r.occurredAt,
      recordedAt: r.recordedAt,
      byName: r.byName,
      fromLabel: r.fromUser ?? r.fromPlace ?? null,
      toLabel: r.toUser ?? r.toPlace ?? null,
      dueBackOn: r.dueBackOn,
      note: r.note,
      viaKit: r.viaKit,
      offline: r.recordedAt.getTime() - r.occurredAt.getTime() > 2 * 60_000,
    }));
  });
}

export interface HeldItem {
  id: string;
  siteId: string;
  siteCode: string;
  assetNumber: string;
  kindName: string;
  description: string | null;
  status: ItemStatus;
  holderId: string | null;
  holderName: string | null;
  placeId: string | null;
  placeName: string | null;
  placeKind: 'site' | 'van' | 'store' | 'yard' | null;
  dueBackOn: string | null;
  overdue: boolean;
  checkedOutAt: Date | null;
  isKit: boolean;
  partOf: string | null;
}

const WHO_VIEWS = ['person', 'van', 'site', 'store'] as const;
export type WhoView = (typeof WHO_VIEWS)[number];
export const WHO_LABELS: Record<WhoView, string> = {
  person: 'By person',
  van: 'By van',
  site: 'By site',
  store: 'By store',
};
export function whoViewFrom(text: string | undefined): WhoView {
  return (WHO_VIEWS as readonly string[]).includes(text ?? '') ? (text as WhoView) : 'person';
}

function heldQuery(tx: Tx, now: Date) {
  return tx
    .selectFrom('register.items as i')
    .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
    .innerJoin('core.sites as s', 's.id', 'i.site_id')
    .leftJoin('core.users as u', 'u.id', 'i.holder_user_id')
    .leftJoin('core.locations as l', 'l.id', 'i.location_id')
    .leftJoin('register.items as p', 'p.id', 'i.parent_id')
    .select([
      'i.id',
      'i.site_id as siteId',
      's.code as siteCode',
      'i.asset_number as assetNumber',
      'k.name as kindName',
      'i.description',
      'i.status',
      'u.id as holderId',
      'u.display_name as holderName',
      'l.id as placeId',
      'l.name as placeName',
      'l.kind as placeKind',
      sql<string | null>`to_char(i.due_back_on, 'YYYY-MM-DD')`.as('dueBackOn'),
      sql<boolean>`(i.overdue_at IS NOT NULL AND i.overdue_at <= ${now})`.as('overdue'),
      'i.checked_out_at as checkedOutAt',
      'i.is_kit as isKit',
      'p.asset_number as partOf',
    ]);
}

export interface WhoGroup {
  key: string;
  label: string;
  /** A second line: the depot, or a registration. */
  detail: string | null;
  count: number;
  overdue: number;
  items: HeldItem[];
}

/**
 * Who has what: groups of items by person, van, job site or store, each with a count and
 * its overdue returns. People and vans hold what is out to them; a site holds what is out
 * there; a store holds what is on its shelves.
 */
export async function whoHasWhat(
  db: Db,
  actor: ActorContext,
  view: WhoView,
  options: { siteIds?: readonly string[]; now?: Date } = {},
): Promise<WhoGroup[]> {
  requirePermission(actor, 'checkouts.view');
  const now = options.now ?? new Date();
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let q = heldQuery(tx, now).where('i.status', '<>', 'retired');
    if (options.siteIds)
      q = q.where(
        'i.site_id',
        'in',
        options.siteIds.length ? [...options.siteIds] : ['00000000-0000-0000-0000-000000000000'],
      );
    if (view === 'person')
      q = q.where('i.holder_user_id', 'is not', null).where('i.status', '=', 'out');
    else if (view === 'van')
      q = q.where('l.kind', '=', 'van').where('i.status', 'in', ['out', 'available']);
    else if (view === 'site')
      q = q.where('l.kind', '=', 'site').where('i.status', 'in', ['out', 'available']);
    else
      q = q.where('l.kind', 'in', ['store', 'yard']).where('i.status', 'in', ['out', 'available']);
    // A kit's parts are shown with the kit, not on their own.
    q = q.where('i.parent_id', 'is', null);
    const rows = await q.orderBy('i.asset_number').limit(10_000).execute();
    const groups = new Map<string, WhoGroup>();
    for (const r of rows) {
      const key = view === 'person' ? (r.holderId ?? '') : (r.placeId ?? '');
      const label = view === 'person' ? (r.holderName ?? 'Unknown') : (r.placeName ?? 'Unknown');
      let g = groups.get(key);
      if (!g) {
        g = { key, label, detail: r.siteCode, count: 0, overdue: 0, items: [] };
        groups.set(key, g);
      }
      g.count += 1;
      if (r.overdue) g.overdue += 1;
      g.items.push(r);
    }
    return [...groups.values()].sort(
      (a, b) => b.overdue - a.overdue || a.label.localeCompare(b.label),
    );
  });
}

/** What the person holds, and what is in their van, with what is due back. */
export async function myKit(
  db: Db,
  actor: ActorContext,
  userId = actor.userId,
  now = new Date(),
): Promise<HeldItem[]> {
  requirePermission(actor, 'checkouts.view');
  if (userId !== actor.userId && !can(actor, 'checkouts.edit'))
    throw new ForbiddenError('You can only see your own kit.');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const rows = await heldQuery(tx, now)
      .where('i.status', '=', 'out')
      .where((eb) =>
        eb.or([eb('i.holder_user_id', '=', userId), eb('l.assigned_user_id', '=', userId)]),
      )
      .where('i.parent_id', 'is', null)
      .orderBy(sql`i.overdue_at asc nulls last`)
      .orderBy('i.asset_number')
      .execute();
    return rows;
  });
}

/** Items past their due-back date, oldest first. */
export async function overdueItems(
  db: Db,
  actor: ActorContext,
  options: { siteIds?: readonly string[]; limit?: number; now?: Date } = {},
): Promise<HeldItem[]> {
  requirePermission(actor, 'checkouts.view');
  const now = options.now ?? new Date();
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let q = heldQuery(tx, now).where('i.status', '=', 'out').where('i.overdue_at', '<=', now);
    if (options.siteIds)
      q = q.where(
        'i.site_id',
        'in',
        options.siteIds.length ? [...options.siteIds] : ['00000000-0000-0000-0000-000000000000'],
      );
    return q
      .orderBy('i.overdue_at')
      .limit(options.limit ?? 500)
      .execute();
  });
}

export interface MissingItem {
  id: string;
  siteId: string;
  siteCode: string;
  assetNumber: string;
  kindName: string;
  reportedAt: Date | null;
  reportedBy: string | null;
  lastSeen: string | null;
  note: string | null;
}

/** Items reported missing, with who reported them and when. */
export async function missingItems(
  db: Db,
  actor: ActorContext,
  options: { siteIds?: readonly string[]; limit?: number } = {},
): Promise<MissingItem[]> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let q = tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .innerJoin('core.sites as s', 's.id', 'i.site_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('movements.movements as m')
            .leftJoin('core.users as u', 'u.id', 'm.created_by')
            .leftJoin('core.users as fu', 'fu.id', 'm.from_user_id')
            .leftJoin('core.locations as fl', 'fl.id', 'm.from_location_id')
            .select([
              'm.occurred_at',
              'u.display_name as by',
              'm.note',
              sql<string | null>`coalesce(fu.display_name, fl.name)`.as('last_seen'),
            ])
            .whereRef('m.item_id', '=', 'i.id')
            .where('m.movement_type', '=', 'missing')
            .orderBy('m.occurred_at', 'desc')
            .limit(1)
            .as('r'),
        (join) => join.onTrue(),
      )
      .select([
        'i.id',
        'i.site_id as siteId',
        's.code as siteCode',
        'i.asset_number as assetNumber',
        'k.name as kindName',
        'r.occurred_at as reportedAt',
        'r.by as reportedBy',
        'r.last_seen as lastSeen',
        'r.note',
      ])
      .where('i.status', '=', 'missing');
    if (options.siteIds)
      q = q.where(
        'i.site_id',
        'in',
        options.siteIds.length ? [...options.siteIds] : ['00000000-0000-0000-0000-000000000000'],
      );
    return q
      .orderBy('r.occurred_at', 'desc')
      .limit(options.limit ?? 200)
      .execute();
  });
}

/** Who-has-what as CSV (a person's name is only what the actor may already see on screen). */
export async function whoHasWhatCsv(
  db: Db,
  actor: ActorContext,
  view: WhoView,
  siteIds?: readonly string[],
): Promise<string> {
  const groups = await whoHasWhat(db, actor, view, { siteIds });
  const header = [
    'Group',
    'Depot',
    'Asset number',
    'Kind',
    'Description',
    'Status',
    'Due back',
    'Overdue',
    'Kit',
  ];
  const lines = [header];
  for (const g of groups)
    for (const i of g.items)
      lines.push([
        g.label,
        i.siteCode,
        i.assetNumber,
        i.kindName,
        i.description ?? '',
        i.status,
        i.dueBackOn ?? '',
        i.overdue ? 'Yes' : 'No',
        i.partOf ?? '',
      ]);
  return lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A CSV cell that spreadsheets can't run as a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface PlaceChoice {
  id: string;
  siteId: string;
  kind: 'site' | 'van' | 'store' | 'yard';
  code: string;
  name: string;
  assignedToMe: boolean;
}

export interface MovementChoices {
  places: PlaceChoice[];
  people: { id: string; name: string; siteIds: string[] }[];
  /** The depot's own store per depot, where check-in defaults to. */
  homeStores: Record<string, string>;
}

/** The places and people the check-out and check-in screens offer, for the depots the actor works at. */
export async function movementChoices(db: Db, actor: ActorContext): Promise<MovementChoices> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const places = await tx
      .selectFrom('core.locations')
      .select(['id', 'site_id as siteId', 'kind', 'code', 'name', 'assigned_user_id as assigned'])
      .where('archived_at', 'is', null)
      .orderBy('code')
      .execute();
    const everyone = can(actor, 'checkouts.edit');
    const users = everyone
      ? await sql<{ id: string; name: string; site_ids: string[] }>`
          SELECT u.id, u.display_name AS name, core.accessible_site_ids(u.id)::text[] AS site_ids
            FROM core.users u WHERE u.archived_at IS NULL ORDER BY u.display_name`.execute(tx)
      : { rows: [] };
    const homeStores: Record<string, string> = {};
    for (const p of places)
      if (p.kind === 'store' && !homeStores[p.siteId]) homeStores[p.siteId] = p.id;
    return {
      places: places.map((p) => ({
        id: p.id,
        siteId: p.siteId,
        kind: p.kind,
        code: p.code,
        name: p.name,
        assignedToMe: p.assigned === actor.userId,
      })),
      people: users.rows
        .map((u) => ({ id: u.id, name: u.name, siteIds: u.site_ids }))
        .filter(
          (u) =>
            u.siteIds.some((s) => actor.siteIds.includes(s)) || can(actor, 'checkouts.approve'),
        ),
      homeStores,
    };
  });
}
