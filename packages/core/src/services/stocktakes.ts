import {
  sql,
  withScope,
  type Db,
  type ItemStatus,
  type StocktakeDecision,
  type Tx,
} from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getSetting } from './settings';
import { movementError, recordedAt } from './movements';
import { parse } from './validation';

// Stocktake by location (S3-5, CO-5, A17). Start one for a store, cage, yard or van, scan
// everything that is physically there, then look at the result: expected and found,
// expected but not found (mark Missing, or Ignore with a reason) and found but not
// expected (Move here, or Note only). Closing records the result, applies only the choices
// made, and is audited. Scanning works offline; the result and closing need the server,
// which is the record of truth.

const uuid = z.string().uuid();

export const startStocktakeSchema = z.object({
  clientId: uuid.optional(),
  locationId: uuid,
  occurredAt: z.string().optional(),
});
export type StartStocktakeInput = z.input<typeof startStocktakeSchema>;

export const scanSchema = z.object({
  stocktakeId: uuid,
  itemId: uuid,
  occurredAt: z.string().optional(),
});
export type ScanInput = z.input<typeof scanSchema>;

export interface StocktakeSummary {
  id: string;
  siteId: string;
  siteCode: string;
  locationId: string;
  locationName: string;
  locationKind: string;
  status: 'counting' | 'closed';
  startedAt: Date;
  startedBy: string | null;
  closedAt: Date | null;
  scanned: number;
  expected: number | null;
  found: number | null;
  notFound: number | null;
  unexpected: number | null;
}

export interface StocktakeLineView {
  itemId: string;
  assetNumber: string;
  kindName: string;
  status: ItemStatus;
  /** Where the register has it now, when that isn't the counted location. */
  elsewhere: string | null;
  decision: StocktakeDecision | null;
  reason: string | null;
  /** For an unexpected item: it can be moved here. */
  canMove: boolean;
  /** Why it can't be moved here. */
  cannotMoveWhy: string | null;
}

export interface StocktakeResult {
  stocktake: StocktakeSummary;
  found: StocktakeLineView[];
  notFound: StocktakeLineView[];
  unexpected: StocktakeLineView[];
}

function summaryQuery(tx: Tx) {
  return tx
    .selectFrom('movements.stocktakes as st')
    .innerJoin('core.sites as s', 's.id', 'st.site_id')
    .innerJoin('core.locations as l', 'l.id', 'st.location_id')
    .leftJoin('core.users as u', 'u.id', 'st.created_by')
    .select([
      'st.id',
      'st.site_id as siteId',
      's.code as siteCode',
      'st.location_id as locationId',
      'l.name as locationName',
      'l.kind as locationKind',
      'st.status',
      'st.started_at as startedAt',
      'u.display_name as startedBy',
      'st.closed_at as closedAt',
      sql<number>`(SELECT count(*) FROM movements.stocktake_lines x WHERE x.stocktake_id = st.id AND x.scanned_at IS NOT NULL)::int`.as(
        'scanned',
      ),
      'st.expected_count as expected',
      'st.found_count as found',
      'st.not_found_count as notFound',
      'st.unexpected_count as unexpected',
    ]);
}

/** Starts a count of a location. One at a time per location; a phone's replay returns the same count. */
export async function startStocktake(
  db: Db,
  actor: ActorContext,
  input: StartStocktakeInput,
): Promise<StocktakeSummary> {
  requirePermission(actor, 'checkouts.create');
  const v = parse(startStocktakeSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    if (v.clientId) {
      const prior = await summaryQuery(tx).where('st.id', '=', v.clientId).executeTakeFirst();
      if (prior) return prior;
    }
    const place = await tx
      .selectFrom('core.locations')
      .select(['id', 'site_id', 'archived_at'])
      .where('id', '=', v.locationId)
      .executeTakeFirst();
    if (!place || place.archived_at) throw new NotFoundError('Location not found.');
    try {
      const row = await tx
        .insertInto('movements.stocktakes')
        .values({
          ...(v.clientId ? { id: v.clientId } : {}),
          site_id: place.site_id,
          location_id: place.id,
          started_at: at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return await summaryQuery(tx).where('st.id', '=', row.id).executeTakeFirstOrThrow();
    } catch (error) {
      if (
        (error as { constraint?: string } | null)?.constraint ===
        'stocktakes_one_counting_per_location'
      )
        throw new ConflictError(
          'That location is already being counted. Carry on with that count, or close it first.',
        );
      throw error;
    }
  });
}

/** Records that an item was scanned in a count. Scanning it twice changes nothing. */
export async function scanStocktake(
  db: Db,
  actor: ActorContext,
  input: ScanInput,
): Promise<{ assetNumber: string; already: boolean }> {
  requirePermission(actor, 'checkouts.create');
  const v = parse(scanSchema, input);
  const at = recordedAt(v.occurredAt);
  return withScope(db, scopeOf(actor), async (tx) => {
    const st = await tx
      .selectFrom('movements.stocktakes')
      .select(['id', 'site_id', 'status'])
      .where('id', '=', v.stocktakeId)
      .executeTakeFirst();
    if (!st) throw new NotFoundError('Stocktake not found.');
    if (st.status === 'closed')
      throw new ConflictError('That stocktake has been closed, so this scan wasn’t added.');
    const item = await tx
      .selectFrom('register.items')
      .select(['id', 'asset_number'])
      .where('id', '=', v.itemId)
      .executeTakeFirst();
    if (!item) throw new NotFoundError('Item not found.');
    const inserted = await tx
      .insertInto('movements.stocktake_lines')
      .values({
        site_id: st.site_id,
        stocktake_id: st.id,
        item_id: item.id,
        scanned_at: at,
        scanned_by: actor.userId,
      })
      .onConflict((oc) => oc.columns(['stocktake_id', 'item_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return { assetNumber: item.asset_number, already: !inserted };
  });
}

/** Works out what the register expects at the location and compares it with the scans. */
async function compute(tx: Tx, stocktakeId: string): Promise<StocktakeResult> {
  const st = await summaryQuery(tx).where('st.id', '=', stocktakeId).executeTakeFirst();
  if (!st) throw new NotFoundError('Stocktake not found.');
  if (st.status === 'closed') {
    const lines = await tx
      .selectFrom('movements.stocktake_lines as x')
      .innerJoin('register.items as i', 'i.id', 'x.item_id')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .leftJoin('core.locations as el', 'el.id', 'i.location_id')
      .select([
        'x.item_id as itemId',
        'i.asset_number as assetNumber',
        'k.name as kindName',
        'i.status',
        'el.name as elsewhere',
        'x.outcome',
        'x.decision',
        'x.reason',
      ])
      .where('x.stocktake_id', '=', stocktakeId)
      .orderBy('i.asset_number')
      .execute();
    const view = (l: (typeof lines)[number]): StocktakeLineView => ({
      itemId: l.itemId,
      assetNumber: l.assetNumber,
      kindName: l.kindName,
      status: l.status,
      elsewhere: l.elsewhere,
      decision: l.decision,
      reason: l.reason,
      canMove: false,
      cannotMoveWhy: null,
    });
    return {
      stocktake: st,
      found: lines.filter((l) => l.outcome === 'found').map(view),
      notFound: lines.filter((l) => l.outcome === 'not_found').map(view),
      unexpected: lines.filter((l) => l.outcome === 'unexpected').map(view),
    };
  }
  // Expected: whatever the register has in this place now (a kit counts once, with its parts).
  const expected = await tx
    .selectFrom('register.items as i')
    .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
    .select(['i.id as itemId', 'i.asset_number as assetNumber', 'k.name as kindName', 'i.status'])
    .where('i.location_id', '=', st.locationId)
    .where('i.status', 'in', ['available', 'out'])
    .where('i.parent_id', 'is', null)
    .orderBy('i.asset_number')
    .execute();
  const scanned = await tx
    .selectFrom('movements.stocktake_lines as x')
    .innerJoin('register.items as i', 'i.id', 'x.item_id')
    .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
    .leftJoin('core.locations as el', 'el.id', 'i.location_id')
    .leftJoin('register.items as p', 'p.id', 'i.parent_id')
    .select([
      'x.item_id as itemId',
      'i.asset_number as assetNumber',
      'k.name as kindName',
      'i.status',
      'i.location_id as locationId',
      'p.location_id as kitLocationId',
      'el.name as elsewhere',
      'x.decision',
      'x.reason',
    ])
    .where('x.stocktake_id', '=', stocktakeId)
    .where('x.scanned_at', 'is not', null)
    .orderBy('i.asset_number')
    .execute();
  const seen = new Set(scanned.map((s) => s.itemId));
  const expectedIds = new Set(expected.map((e) => e.itemId));
  const base = {
    elsewhere: null as string | null,
    decision: null,
    reason: null,
    canMove: false,
    cannotMoveWhy: null,
  };
  const found: StocktakeLineView[] = [];
  const notFound: StocktakeLineView[] = [];
  const unexpected: StocktakeLineView[] = [];
  for (const e of expected) {
    const line = {
      ...base,
      itemId: e.itemId,
      assetNumber: e.assetNumber,
      kindName: e.kindName,
      status: e.status,
    };
    (seen.has(e.itemId) ? found : notFound).push(line);
  }
  for (const s of scanned) {
    if (expectedIds.has(s.itemId)) continue;
    // A part of a kit that is here counts as found with its kit.
    if (s.kitLocationId === st.locationId) {
      found.push({
        ...base,
        itemId: s.itemId,
        assetNumber: s.assetNumber,
        kindName: s.kindName,
        status: s.status,
      });
      continue;
    }
    const movable = s.status === 'available' || s.status === 'out' || s.status === 'missing';
    unexpected.push({
      ...base,
      itemId: s.itemId,
      assetNumber: s.assetNumber,
      kindName: s.kindName,
      status: s.status,
      elsewhere: s.elsewhere,
      canMove: movable,
      cannotMoveWhy: movable
        ? null
        : `It is ${s.status.replace('_', ' ')}, so it can’t be moved by a stocktake.`,
    });
  }
  return { stocktake: st, found, notFound, unexpected };
}

/** The result so far (or the final one), for the result screen. */
export async function stocktakeResult(
  db: Db,
  actor: ActorContext,
  id: string,
): Promise<StocktakeResult> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) => compute(tx, id));
}

export const closeSchema = z.object({
  stocktakeId: uuid,
  note: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null)
    .nullable()
    .default(null),
  /** One choice per line that needs one, keyed by item id. */
  decisions: z.record(
    uuid,
    z.object({
      decision: z.enum(['missing', 'ignored', 'moved_here', 'note_only']),
      reason: z.string().trim().max(500).optional(),
    }),
  ),
});
export type CloseStocktakeInput = z.input<typeof closeSchema>;

/**
 * Closes the count: records the result, applies only the choices made (missing items are
 * reported missing; unexpected items the person chose to move are moved here) and stamps the
 * location with the date. All or nothing; a choice the database refuses names the item.
 */
export async function closeStocktake(
  db: Db,
  actor: ActorContext,
  input: CloseStocktakeInput,
): Promise<StocktakeSummary> {
  requirePermission(actor, 'checkouts.edit');
  const v = parse(closeSchema, input);
  return withScope(db, scopeOf(actor), async (tx) => {
    const locked = await tx
      .selectFrom('movements.stocktakes')
      .select(['id', 'status'])
      .where('id', '=', v.stocktakeId)
      .forUpdate()
      .executeTakeFirst();
    if (!locked) throw new NotFoundError('Stocktake not found.');
    if (locked.status === 'closed')
      throw new ConflictError('This stocktake has already been closed.');
    const result = await compute(tx, v.stocktakeId);
    const st = result.stocktake;
    const missingChoices: string[] = [];
    const fields: Record<string, string> = {};
    for (const l of result.notFound) {
      const d = v.decisions[l.itemId];
      if (!d || (d.decision !== 'missing' && d.decision !== 'ignored'))
        missingChoices.push(l.assetNumber);
      else if (d.decision === 'ignored' && (d.reason ?? '').length < 3)
        fields[`reason-${l.itemId}`] = `Say why ${l.assetNumber} is being ignored.`;
    }
    for (const l of result.unexpected) {
      const d = v.decisions[l.itemId];
      if (!d || (d.decision !== 'moved_here' && d.decision !== 'note_only'))
        missingChoices.push(l.assetNumber);
      else if (d.decision === 'moved_here' && !l.canMove)
        fields[`decision-${l.itemId}`] = l.cannotMoveWhy ?? 'That can’t be moved here.';
    }
    if (missingChoices.length || Object.keys(fields).length)
      throw new ValidationError(
        missingChoices.length
          ? `Choose what to do about ${missingChoices.length === 1 ? 'this item' : 'each of these'}: ${missingChoices.slice(0, 6).join(', ')}${missingChoices.length > 6 ? ' and more' : ''}.`
          : 'Check the highlighted choices.',
        fields,
      );
    const now = new Date();
    const noteFor = `Stocktake of ${st.locationName}`;
    const apply = async (itemId: string, type: 'missing' | 'move' | 'found') => {
      try {
        await tx
          .insertInto('movements.movements')
          .values({
            site_id: st.siteId,
            item_id: itemId,
            movement_type: type,
            to_location_id: type === 'missing' ? null : st.locationId,
            note: type === 'missing' ? `Not found in the stocktake of ${st.locationName}` : noteFor,
            occurred_at: now,
          })
          .execute();
      } catch (error) {
        return movementError(error);
      }
    };
    for (const l of result.notFound) {
      const d = v.decisions[l.itemId]!;
      if (d.decision === 'missing') await apply(l.itemId, 'missing');
    }
    for (const l of result.unexpected) {
      if (v.decisions[l.itemId]!.decision === 'moved_here')
        await apply(l.itemId, l.status === 'missing' ? 'found' : 'move');
    }
    const lines: [StocktakeLineView[], 'found' | 'not_found' | 'unexpected'][] = [
      [result.found, 'found'],
      [result.notFound, 'not_found'],
      [result.unexpected, 'unexpected'],
    ];
    for (const [views, outcome] of lines)
      for (const l of views) {
        const d = outcome === 'found' ? undefined : v.decisions[l.itemId];
        const set = {
          expected: outcome !== 'unexpected',
          outcome,
          decision: d?.decision ?? null,
          reason: d?.decision === 'ignored' ? (d.reason ?? null) : null,
        };
        const updated = await tx
          .updateTable('movements.stocktake_lines')
          .set(set)
          .where('stocktake_id', '=', st.id)
          .where('item_id', '=', l.itemId)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n)
          await tx
            .insertInto('movements.stocktake_lines')
            .values({ site_id: st.siteId, stocktake_id: st.id, item_id: l.itemId, ...set })
            .execute();
      }
    await tx
      .updateTable('movements.stocktakes')
      .set({
        status: 'closed',
        closed_at: now,
        closed_by: actor.userId,
        expected_count: result.found.length + result.notFound.length,
        found_count: result.found.length,
        not_found_count: result.notFound.length,
        unexpected_count: result.unexpected.length,
        note: v.note,
      })
      .where('id', '=', st.id)
      .execute();
    await tx
      .updateTable('core.locations')
      .set({ last_counted_at: now })
      .where('id', '=', st.locationId)
      .execute();
    return summaryQuery(tx).where('st.id', '=', st.id).executeTakeFirstOrThrow();
  });
}

/** Counts in progress and the last few closed, for the stocktake page. */
export async function listStocktakes(
  db: Db,
  actor: ActorContext,
  limit = 30,
): Promise<StocktakeSummary[]> {
  requirePermission(actor, 'checkouts.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    summaryQuery(tx)
      .orderBy(sql`st.status = 'counting' desc`)
      .orderBy('st.started_at', 'desc')
      .limit(limit)
      .execute(),
  );
}

export interface CountableLocation {
  id: string;
  siteId: string;
  siteCode: string;
  name: string;
  kind: string;
  lastCountedAt: Date | null;
  /** More days than the recount setting since it was counted (or never). */
  due: boolean;
  counting: string | null;
}

/** Every location that can be counted, with when it was last counted. */
export async function countableLocations(
  db: Db,
  actor: ActorContext,
  now = new Date(),
): Promise<CountableLocation[]> {
  requirePermission(actor, 'checkouts.view');
  const days = await getSetting(db, 'stocktake.recount_days');
  const limit = new Date(now.getTime() - days * 86_400_000);
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const rows = await tx
      .selectFrom('core.locations as l')
      .innerJoin('core.sites as s', 's.id', 'l.site_id')
      .leftJoin('movements.stocktakes as c', (j) =>
        j.onRef('c.location_id', '=', 'l.id').on('c.status', '=', 'counting'),
      )
      .select([
        'l.id',
        'l.site_id as siteId',
        's.code as siteCode',
        'l.name',
        'l.kind',
        'l.last_counted_at as lastCountedAt',
        'c.id as counting',
      ])
      .where('l.archived_at', 'is', null)
      .where('s.archived_at', 'is', null)
      .where('l.kind', '<>', 'site')
      .orderBy('s.code')
      .orderBy('l.code')
      .execute();
    return rows.map((r) => ({ ...r, due: r.lastCountedAt === null || r.lastCountedAt < limit }));
  });
}
