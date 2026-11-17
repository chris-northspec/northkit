import {
  LOCATION_KINDS,
  sql,
  withScope,
  type Db,
  type Location,
  type LocationKind,
  type Tx,
} from '@northkit/db';
import { z } from 'zod';
import { requirePermission, requireSite, scopeOf, type ActorContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { isUniqueViolation, parse } from './validation';

// The places kit can be, per site: stores, vans, yards and job sites, optionally nested.
// Copied from NorthKeep main (944121d). The path is kept in step with the parent by
// triggers (migration 0002); this layer turns their refusals into messages people can act on.

export { LOCATION_KINDS };
export type { LocationKind };

export const KIND_LABELS: Record<LocationKind, string> = {
  site: 'Job site',
  van: 'Van',
  store: 'Store',
  yard: 'Yard',
};

/** A kind from a code or its label, any case ('Bay', 'bay', ' BAY '). */
export function kindFrom(text: string): LocationKind | null {
  const t = text.trim().toLowerCase();
  return (LOCATION_KINDS as readonly string[]).includes(t) ? (t as LocationKind) : null;
}

export const LOCATION_CODE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

const optionalId = z.string().uuid().nullable().default(null);

export const locationInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(LOCATION_CODE, 'Use up to 40 letters, digits, dots, hyphens or underscores.'),
  name: z.string().trim().min(1, 'Enter a name.').max(200, 'Use 200 characters or fewer.'),
  kind: z.enum(LOCATION_KINDS, { message: 'Choose a kind.' }),
  parentId: optionalId,
  reference: z
    .string()
    .trim()
    .max(100, 'Use 100 characters or fewer.')
    .transform((v) => v || null)
    .nullable()
    .default(null),
  notes: z
    .string()
    .trim()
    .max(2000, 'Use 2,000 characters or fewer.')
    .transform((v) => v || null)
    .nullable()
    .default(null),
});
export type LocationInput = z.input<typeof locationInputSchema>;

export interface LocationRow extends Location {
  parent_code: string | null;
  /** Live locations directly under this one. */
  child_count: number;
}

/** Turns trigger and key refusals into field messages. */
export function locationError(error: unknown): never {
  const e = error as { code?: string; constraint?: string } | null;
  if (isUniqueViolation(error))
    throw new ConflictError('A location with that code already exists at this site.');
  if (e?.constraint === 'locations_no_cycle')
    throw new ValidationError(
      'A location can’t be moved under itself or one of its own children.',
      {
        parentId: 'Choose a different parent.',
      },
    );
  if (e?.code === '23503')
    throw new ValidationError('Check the highlighted fields.', {
      parentId: 'Choose a location at this site.',
    });
  throw error;
}

function rowQuery(tx: Tx) {
  return tx
    .selectFrom('core.locations as l')
    .leftJoin('core.locations as p', 'p.id', 'l.parent_id')
    .selectAll('l')
    .select([
      'p.code as parent_code',
      (eb) =>
        eb
          .selectFrom('core.locations as c')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('c.parent_id', '=', 'l.id')
          .where('c.archived_at', 'is', null)
          .as('child_count'),
    ]);
}

const toRow = (r: Omit<LocationRow, 'child_count'> & { child_count: number | string | null }) => ({
  ...r,
  child_count: Number(r.child_count ?? 0),
});

/**
 * One level of the tree: the top (parentId null) or the children of a location.
 * With `search`, matching locations anywhere in the site instead.
 */
export async function listLocations(
  db: Db,
  actor: ActorContext,
  siteId: string,
  options: {
    parentId?: string | null;
    search?: string;
    /** Every location at the site, ordered by code (for pickers). */
    all?: boolean;
    includeArchived?: boolean;
    limit?: number;
  } = {},
): Promise<LocationRow[]> {
  requirePermission(actor, 'locations.view');
  requireSite(actor, siteId);
  return withScope(db, scopeOf(actor), async (tx) => {
    let q = rowQuery(tx)
      .where('l.site_id', '=', siteId)
      .orderBy('l.code')
      .limit(options.limit ?? 500);
    const search = options.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('l.code', 'ilike', like), eb('l.name', 'ilike', like)]));
    } else if (options.all) {
      // No tree filter: every location at the site.
    } else if (options.parentId) q = q.where('l.parent_id', '=', options.parentId);
    else q = q.where('l.parent_id', 'is', null);
    if (!options.includeArchived) q = q.where('l.archived_at', 'is', null);
    return (await q.execute()).map(toRow);
  });
}

export async function getLocation(db: Db, actor: ActorContext, id: string): Promise<LocationRow> {
  requirePermission(actor, 'locations.view');
  const row = await withScope(db, scopeOf(actor), (tx) =>
    rowQuery(tx).where('l.id', '=', id).executeTakeFirst(),
  );
  if (!row) throw new NotFoundError('Location not found.');
  return toRow(row);
}

/** The chain from the top of the tree down to (not including) the location. */
export async function locationAncestors(
  db: Db,
  actor: ActorContext,
  id: string,
): Promise<Pick<Location, 'id' | 'code' | 'name'>[]> {
  requirePermission(actor, 'locations.view');
  return withScope(db, scopeOf(actor), async (tx) => {
    const self = await tx
      .selectFrom('core.locations')
      .select('path')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!self) throw new NotFoundError('Location not found.');
    return tx
      .selectFrom('core.locations')
      .select(['id', 'code', 'name'])
      .where(sql<boolean>`path @> ${self.path}::ltree`)
      .where('id', '<>', id)
      .orderBy(sql`nlevel(path)`)
      .execute();
  });
}

async function checkPlacement(
  tx: Tx,
  siteId: string,
  v: z.output<typeof locationInputSchema>,
): Promise<void> {
  if (v.parentId) {
    const parent = await tx
      .selectFrom('core.locations')
      .select('id')
      .where('id', '=', v.parentId)
      .where('site_id', '=', siteId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!parent)
      throw new ValidationError('Check the highlighted fields.', {
        parentId: 'Choose a current location at this site.',
      });
  }
}

export async function createLocation(
  db: Db,
  actor: ActorContext,
  siteId: string,
  input: LocationInput,
): Promise<Location> {
  requirePermission(actor, 'locations.create');
  requireSite(actor, siteId);
  const v = parse(locationInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      await checkPlacement(tx, siteId, v);
      return tx
        .insertInto('core.locations')
        .values({
          site_id: siteId,
          parent_id: v.parentId,
          kind: v.kind,
          code: v.code,
          name: v.name,
          reference: v.reference,
          notes: v.notes,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    locationError(error);
  }
}

/** Renames, re-kinds or moves a location; its whole subtree moves with it. */
export async function updateLocation(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  input: LocationInput,
): Promise<Location> {
  requirePermission(actor, 'locations.edit');
  const v = parse(locationInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const current = await tx
        .selectFrom('core.locations')
        .select(['site_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundError('Location not found.');
      await checkPlacement(tx, current.site_id, v);
      const row = await tx
        .updateTable('core.locations')
        .set({
          code: v.code,
          name: v.name,
          kind: v.kind,
          parent_id: v.parentId,
          reference: v.reference,
          notes: v.notes,
        })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .returningAll()
        .executeTakeFirst();
      if (!row)
        throw new ConflictError('Someone else changed this location. Reload and try again.');
      return row;
    });
  } catch (error) {
    locationError(error);
  }
}

/** Archive (refused while live locations sit under it) or restore a location. */
export async function setLocationArchived(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  archived: boolean,
): Promise<void> {
  requirePermission(actor, 'locations.edit');
  await withScope(db, scopeOf(actor), async (tx) => {
    if (archived) {
      const child = await tx
        .selectFrom('core.locations')
        .select('id')
        .where('parent_id', '=', id)
        .where('archived_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      if (child) throw new ValidationError('Archive the locations under this one first.');
    }
    const r = await tx
      .updateTable('core.locations')
      .set({ archived_at: archived ? new Date() : null })
      .where('id', '=', id)
      .where('row_version', '=', rowVersion)
      .executeTakeFirst();
    if (r.numUpdatedRows === 0n)
      throw new ConflictError('Someone else changed this location. Reload and try again.');
  });
}
