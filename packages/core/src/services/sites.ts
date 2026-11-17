import { sql, withScope, type Db, type Site, type Tx } from '@northkit/db';
import { z } from 'zod';
import { requirePermission, requireSite, scopeOf, type ActorContext } from '../context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { uuidv7 } from '../ids';
import { isUniqueViolation, parse } from './validation';

// Sites: the depots and branches kit is run from. Copied from NorthKeep main (944121d)
// and trimmed (no buildings, contacts or opening hours). core.sites is the isolation root: a new site
// is outside every scope until it exists, so its id is made here and added to the
// creating transaction's scope.

/** True if the IANA time zone is one this server knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .transform((value) => value || null)
    .nullable()
    .default(null);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+$/.test(v), 'Enter a valid email address.')
  .transform((v) => v || null)
  .nullable()
  .default(null);

export const siteInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use up to 20 letters, digits, hyphens or underscores.'),
  name: z.string().trim().min(1, 'Enter a name.').max(200, 'Use 200 characters or fewer.'),
  addressLine1: optional(200),
  addressLine2: optional(200),
  town: optional(100),
  postcode: optional(20),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter country code, e.g. GB.')
    .default('GB'),
  timeZone: z
    .string()
    .trim()
    .default('Europe/London')
    .refine(isTimeZone, 'Choose a time zone from the list, e.g. Europe/London.'),
  phone: optional(40),
  email: optionalEmail,
  managerUserId: z.string().uuid().nullable().default(null),
  notes: optional(2000),
});
export type SiteInput = z.input<typeof siteInputSchema>;

function toRow(values: z.output<typeof siteInputSchema>) {
  return {
    code: values.code,
    name: values.name,
    address_line_1: values.addressLine1,
    address_line_2: values.addressLine2,
    town: values.town,
    postcode: values.postcode,
    country_code: values.countryCode,
    time_zone: values.timeZone,
    phone: values.phone,
    email: values.email,
    manager_user_id: values.managerUserId,
    notes: values.notes,
  };
}

const CODE_TAKEN = 'A site with that code already exists.';

/**
 * Inserts a validated site inside an existing transaction whose scope already
 * includes `id` (first-run set-up, createSite).
 */
export async function insertSite(tx: Tx, id: string, input: SiteInput): Promise<Site> {
  const values = parse(siteInputSchema, input);
  try {
    return await tx
      .insertInto('core.sites')
      .values({ id, ...toRow(values) })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(CODE_TAKEN);
    throw error;
  }
}

/** The sites in the actor's scope; archived ones only on request. */
export async function listSites(
  db: Db,
  actor: ActorContext,
  options: { includeArchived?: boolean } = {},
): Promise<Site[]> {
  requirePermission(actor, 'overview.view');
  return siteRows(db, actor, options);
}

function siteRows(db: Db, actor: ActorContext, options: { includeArchived?: boolean }) {
  return withScope(db, scopeOf(actor), (tx) => {
    let query = tx.selectFrom('core.sites').selectAll().orderBy('code');
    if (!options.includeArchived) query = query.where('archived_at', 'is', null);
    return query.execute();
  });
}

export interface SiteChoice {
  id: string;
  code: string;
  name: string;
}

/**
 * Live sites in the actor's scope, for the site selector and pickers. Needs no
 * permission: it shows only codes and names of sites the actor already works at.
 */
export async function siteChoices(db: Db, actor: ActorContext): Promise<SiteChoice[]> {
  if (actor.siteIds.length === 0) return [];
  const rows = await siteRows(db, actor, {});
  return rows.map(({ id, code, name }) => ({ id, code, name }));
}

export async function getSite(db: Db, actor: ActorContext, id: string): Promise<Site> {
  requirePermission(actor, 'overview.view');
  requireSite(actor, id);
  const site = await withScope(db, scopeOf(actor), (tx) =>
    tx.selectFrom('core.sites').selectAll().where('id', '=', id).executeTakeFirst(),
  );
  if (!site) throw new NotFoundError('Site not found.');
  return site;
}

export async function createSite(
  db: Db,
  actor: ActorContext,
  input: SiteInput,
  options: { maxSites?: number | null } = {},
): Promise<Site> {
  requirePermission(actor, 'settings.create');
  // A new site is outside every listed scope, so only someone who works at every
  // site can add one (they'd otherwise make a site they can't see).
  if (!actor.allSites)
    throw new ForbiddenError('Only users who work at every site can add a site.');
  const id = uuidv7();
  return withScope(db, scopeOf(actor, [id]), async (tx) => {
    if (options.maxSites) {
      const { rows } = await sql<{ n: number }>`SELECT core.live_site_count() AS n`.execute(tx);
      if ((rows[0]?.n ?? 0) >= options.maxSites)
        throw new ValidationError(
          `Your licence covers ${options.maxSites} sites. Archive a site or ask NorthSpec about a larger licence.`,
        );
    }
    return insertSite(tx, id, input);
  });
}

async function updateVersioned(
  tx: Tx,
  id: string,
  rowVersion: number,
  values: Partial<ReturnType<typeof toRow>> & { archived_at?: Date | null },
): Promise<Site> {
  const updated = await tx
    .updateTable('core.sites')
    .set(values)
    .where('id', '=', id)
    .where('row_version', '=', rowVersion)
    .returningAll()
    .executeTakeFirst();
  if (updated) return updated;
  const exists = await tx.selectFrom('core.sites').select('id').where('id', '=', id).execute();
  if (exists.length === 0) throw new NotFoundError('Site not found.');
  throw new ConflictError('Someone else changed this site. Reload it and try again.');
}

export async function updateSite(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  input: SiteInput,
): Promise<Site> {
  requirePermission(actor, 'settings.edit');
  requireSite(actor, id);
  const values = parse(siteInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), (tx) =>
      updateVersioned(tx, id, rowVersion, toRow(values)),
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(CODE_TAKEN);
    throw error;
  }
}

/** Sites are archived, never deleted (DB-04): history keeps pointing at them. */
export async function setSiteArchived(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  archived: boolean,
): Promise<Site> {
  requirePermission(actor, 'settings.edit');
  requireSite(actor, id);
  return withScope(db, scopeOf(actor), (tx) =>
    updateVersioned(tx, id, rowVersion, { archived_at: archived ? new Date() : null }),
  );
}
