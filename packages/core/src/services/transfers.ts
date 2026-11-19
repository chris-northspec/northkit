import { sql, withScope, type Db, type Tx } from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { movementError, recordedAt, today } from './movements';
import { parse } from './validation';

// Transfers between depots (S3-3, CO-2, A18). Two steps: Send (the item is in transit, with
// the sender, the carrier or van and the expected date), then Receive at the destination
// depot. Both depots can see the transfer; neither can see the other's other items. An
// item in transit can't be checked out (the database refuses). A transfer not received by
// its expected date needs action at both depots.

const uuid = z.string().uuid();
const note = z
  .string()
  .trim()
  .max(1000, 'Use 1,000 characters or fewer.')
  .transform((v) => v || null)
  .nullable()
  .default(null);

export const sendSchema = z.object({
  clientId: uuid.optional(),
  itemId: uuid,
  toSiteId: uuid,
  carrier: z
    .string()
    .trim()
    .min(1, 'Say who or what is carrying it.')
    .max(200, 'Use 200 characters or fewer.'),
  expectedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date it should arrive, as day, month and year.'),
  note,
  occurredAt: z.string().optional(),
});
export type SendInput = z.input<typeof sendSchema>;

export const receiveSchema = z.object({
  clientId: uuid.optional(),
  transferId: uuid,
  locationId: uuid,
  note,
  occurredAt: z.string().optional(),
});
export type ReceiveInput = z.input<typeof receiveSchema>;

export interface TransferRow {
  id: string;
  fromSiteId: string;
  fromSiteCode: string;
  toSiteId: string;
  toSiteCode: string;
  itemId: string;
  assetNumber: string;
  kindName: string;
  carrier: string;
  expectedOn: string;
  sentAt: Date;
  sentBy: string | null;
  note: string | null;
  status: 'in_transit' | 'received' | 'cancelled';
  closedAt: Date | null;
  overdue: boolean;
  /** For a kit: how many parts go with it. */
  parts: number;
  /** The actor can receive it (it is coming to a depot they work at). */
  incoming: boolean;
}

export interface TransferResult {
  transferId: string;
  itemId: string;
  assetNumber: string;
  message: string;
}

/** Live depots a person can send to: every depot but the item's own. */
export async function transferDestinations(
  db: Db,
  actor: ActorContext,
): Promise<{ id: string; code: string; name: string }[]> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const { rows } = await sql<{ id: string; code: string; name: string }>`
      SELECT id, code, name FROM movements.transfer_destinations()`.execute(tx);
    return rows;
  });
}

/** Sends an item (a kit with its parts) to another depot. Needs a Supervisor or above. */
export async function sendTransfer(
  db: Db,
  actor: ActorContext,
  input: SendInput,
): Promise<TransferResult> {
  requirePermission(actor, 'checkouts.edit');
  const v = parse(sendSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const item = await tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .innerJoin('core.sites as s', 's.id', 'i.site_id')
      .select([
        'i.id',
        'i.site_id as siteId',
        'i.asset_number as assetNumber',
        'i.is_kit as isKit',
        'i.status',
        'k.name as kindName',
        's.time_zone as zone',
        's.code as siteCode',
      ])
      .where('i.id', '=', v.itemId)
      .executeTakeFirst();
    if (!item) throw new NotFoundError('Item not found.');
    if (v.toSiteId === item.siteId)
      throw new ValidationError('Choose another depot.', {
        toSiteId: 'The item is already at that depot. Check it out or move it instead.',
      });
    const { rows: depots } = await sql<{
      id: string;
      code: string;
    }>`SELECT id, code FROM movements.transfer_destinations() WHERE id = ${v.toSiteId}::uuid`.execute(
      tx,
    );
    if (!depots.length)
      throw new ValidationError('Choose a depot.', { toSiteId: 'Choose one of the depots.' });
    if (v.expectedOn < today(at, item.zone))
      throw new ValidationError('Check the date.', {
        expectedOn: 'The expected date can’t be before today.',
      });
    // The replay of a send: already recorded, nothing to add.
    if (v.clientId) {
      const prior = await tx
        .selectFrom('movements.movements')
        .select(['transfer_id'])
        .where('id', '=', v.clientId)
        .executeTakeFirst();
      if (prior?.transfer_id)
        return {
          transferId: prior.transfer_id,
          itemId: item.id,
          assetNumber: item.assetNumber,
          message: `${item.assetNumber} was already sent.`,
        };
    }
    try {
      const make = (
        itemId: string,
        assetNumber: string,
        kindName: string,
        kitTransfer: string | null,
      ) =>
        tx
          .insertInto('movements.transfers')
          .values({
            site_id: item.siteId,
            to_site_id: v.toSiteId,
            from_site_code: item.siteCode,
            to_site_code: depots[0]!.code,
            from_time_zone: item.zone,
            item_id: itemId,
            kit_transfer_id: kitTransfer,
            asset_number: assetNumber,
            kind_name: kindName,
            carrier: v.carrier,
            expected_on: v.expectedOn,
            sent_at: at,
            note: v.note,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      const head = await make(item.id, item.assetNumber, item.kindName, null);
      if (item.isKit) {
        const parts = await tx
          .selectFrom('register.items as i')
          .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
          .select(['i.id', 'i.asset_number as assetNumber', 'k.name as kindName'])
          .where('i.parent_id', '=', item.id)
          .where('i.status', '=', 'available')
          .execute();
        for (const p of parts) await make(p.id, p.assetNumber, p.kindName, head.id);
      }
      await tx
        .insertInto('movements.movements')
        .values({
          ...(v.clientId ? { id: v.clientId } : {}),
          site_id: item.siteId,
          item_id: item.id,
          movement_type: 'transfer_out',
          transfer_id: head.id,
          note: v.note,
          occurred_at: at,
        })
        .execute();
      return {
        transferId: head.id,
        itemId: item.id,
        assetNumber: item.assetNumber,
        message: `${item.assetNumber} sent. It is in transit until the other depot receives it.`,
      };
    } catch (error) {
      if ((error as { constraint?: string } | null)?.constraint === 'transfers_one_open_per_item')
        throw new ConflictError(`${item.assetNumber} is already in transit.`);
      return movementError(error);
    }
  });
}

/** Receives a transfer at the destination depot, putting the item in one of that depot's places. */
export async function receiveTransfer(
  db: Db,
  actor: ActorContext,
  input: ReceiveInput,
): Promise<TransferResult> {
  requirePermission(actor, 'checkouts.edit');
  const v = parse(receiveSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const tr = await tx
      .selectFrom('movements.transfers')
      .select(['id', 'item_id', 'asset_number', 'to_site_id', 'status', 'kit_transfer_id'])
      .where('id', '=', v.transferId)
      .executeTakeFirst();
    if (!tr || !actor.siteIds.includes(tr.to_site_id))
      throw new NotFoundError('Transfer not found.');
    if (v.clientId) {
      const prior = await tx
        .selectFrom('movements.movements')
        .select('id')
        .where('id', '=', v.clientId)
        .executeTakeFirst();
      if (prior)
        return {
          transferId: tr.id,
          itemId: tr.item_id,
          assetNumber: tr.asset_number,
          message: `${tr.asset_number} was already received.`,
        };
    }
    if (tr.kit_transfer_id)
      throw new ConflictError(`${tr.asset_number} is part of a kit. Receive the kit.`);
    if (tr.status !== 'in_transit')
      throw new ConflictError(
        `${tr.asset_number} has already been ${tr.status === 'received' ? 'received' : 'taken back by the sender'}.`,
      );
    const place = await tx
      .selectFrom('core.locations')
      .select(['id', 'site_id', 'name', 'archived_at'])
      .where('id', '=', v.locationId)
      .executeTakeFirst();
    if (!place || place.site_id !== tr.to_site_id || place.archived_at)
      throw new ValidationError('Choose where to put it.', {
        locationId: 'Choose a place at the receiving depot.',
      });
    try {
      await tx
        .insertInto('movements.movements')
        .values({
          ...(v.clientId ? { id: v.clientId } : {}),
          site_id: tr.to_site_id,
          item_id: tr.item_id,
          movement_type: 'transfer_in',
          to_location_id: place.id,
          transfer_id: tr.id,
          note: v.note,
          occurred_at: at,
        })
        .execute();
    } catch (error) {
      return movementError(error);
    }
    return {
      transferId: tr.id,
      itemId: tr.item_id,
      assetNumber: tr.asset_number,
      message: `${tr.asset_number} received at ${place.name}.`,
    };
  });
}

/** The sender takes an item back (it never arrived, or was sent by mistake). */
export async function cancelTransfer(
  db: Db,
  actor: ActorContext,
  transferId: string,
  locationId: string,
  noteText?: string,
): Promise<TransferResult> {
  requirePermission(actor, 'checkouts.edit');
  return withScope(db, scopeOf(actor), async (tx) => {
    const tr = await tx
      .selectFrom('movements.transfers')
      .select(['id', 'item_id', 'asset_number', 'site_id', 'status', 'kit_transfer_id'])
      .where('id', '=', transferId)
      .executeTakeFirst();
    if (!tr || !actor.siteIds.includes(tr.site_id)) throw new NotFoundError('Transfer not found.');
    if (tr.kit_transfer_id)
      throw new ConflictError(`${tr.asset_number} is part of a kit. Take the kit back.`);
    const place = await tx
      .selectFrom('core.locations')
      .select(['id', 'site_id', 'name', 'archived_at'])
      .where('id', '=', locationId)
      .executeTakeFirst();
    if (!place || place.site_id !== tr.site_id || place.archived_at)
      throw new ValidationError('Choose where to put it.', {
        locationId: 'Choose a place at your depot.',
      });
    try {
      await tx
        .insertInto('movements.movements')
        .values({
          site_id: tr.site_id,
          item_id: tr.item_id,
          movement_type: 'transfer_cancel',
          to_location_id: place.id,
          transfer_id: tr.id,
          note: noteText?.trim() || null,
        })
        .execute();
    } catch (error) {
      return movementError(error);
    }
    return {
      transferId: tr.id,
      itemId: tr.item_id,
      assetNumber: tr.asset_number,
      message: `${tr.asset_number} taken back to ${place.name}.`,
    };
  });
}

function transferQuery(tx: Tx, actor: ActorContext, now: Date) {
  return tx
    .selectFrom('movements.transfers as t')
    .leftJoin('core.users as u', 'u.id', 't.created_by')
    .select([
      't.id',
      't.site_id as fromSiteId',
      't.from_site_code as fromSiteCode',
      't.to_site_id as toSiteId',
      't.to_site_code as toSiteCode',
      't.item_id as itemId',
      't.asset_number as assetNumber',
      't.kind_name as kindName',
      't.carrier',
      sql<string>`to_char(t.expected_on, 'YYYY-MM-DD')`.as('expectedOn'),
      't.sent_at as sentAt',
      'u.display_name as sentBy',
      't.note',
      't.status',
      't.closed_at as closedAt',
      sql<boolean>`(t.status = 'in_transit' AND t.expected_on < (${now}::timestamptz AT TIME ZONE t.from_time_zone)::date)`.as(
        'overdue',
      ),
      sql<number>`(SELECT count(*) FROM movements.transfers c WHERE c.kit_transfer_id = t.id)::int`.as(
        'parts',
      ),
    ])
    .where('t.kit_transfer_id', 'is', null)
    .select(
      sql<boolean>`(t.to_site_id = ANY (${sql.val(`{${actor.siteIds.join(',')}}`)}::uuid[]))`.as(
        'incoming',
      ),
    );
}

/** Transfers the actor's depots are part of: coming in, going out, and recently closed. */
export async function listTransfers(
  db: Db,
  actor: ActorContext,
  options: { open?: boolean; limit?: number; now?: Date } = {},
): Promise<TransferRow[]> {
  requirePermission(actor, 'checkouts.view');
  const now = options.now ?? new Date();
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let q = transferQuery(tx, actor, now);
    if (options.open !== false) q = q.where('t.status', '=', 'in_transit');
    return (await q
      .orderBy('t.expected_on')
      .orderBy('t.sent_at', 'desc')
      .limit(options.limit ?? 200)
      .execute()) as TransferRow[];
  });
}

/** The open transfer that brings this item to a depot the actor works at, if any (scanned to receive). */
export async function incomingTransferFor(
  db: Db,
  actor: ActorContext,
  itemId: string,
): Promise<TransferRow | null> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const row = await transferQuery(tx, actor, new Date())
      .where('t.item_id', '=', itemId)
      .where('t.status', '=', 'in_transit')
      .executeTakeFirst();
    return row && (row as TransferRow).incoming ? (row as TransferRow) : null;
  });
}
