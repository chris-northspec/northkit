import { withScope, type Db, type Organisation } from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError } from '../errors';
import { isTimeZone } from './sites';
import { parse } from './validation';

// The customer running this install: one row, made at first-run set-up.

export const organisationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your organisation’s name.')
    .max(200, 'Use 200 characters or fewer.'),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter country code, e.g. GB.')
    .default('GB'),
  defaultTimeZone: z
    .string()
    .trim()
    .default('Europe/London')
    .refine(isTimeZone, 'Choose a time zone from the list, e.g. Europe/London.'),
});
export type OrganisationInput = z.input<typeof organisationInputSchema>;

/** The organisation name for the header; null before set-up. Needs no permission. */
export async function organisationName(db: Db): Promise<string | null> {
  const row = await db.selectFrom('core.organisations').select('name').executeTakeFirst();
  return row?.name ?? null;
}

export async function getOrganisation(db: Db, actor: ActorContext): Promise<Organisation> {
  requirePermission(actor, 'settings.view');
  const row = await db.selectFrom('core.organisations').selectAll().executeTakeFirst();
  if (!row) throw new NotFoundError('Set-up has not been done yet.');
  return row;
}

export async function updateOrganisation(
  db: Db,
  actor: ActorContext,
  input: OrganisationInput,
): Promise<Organisation> {
  requirePermission(actor, 'settings.edit');
  const v = parse(organisationInputSchema, input);
  return withScope(db, scopeOf(actor), (tx) =>
    tx
      .updateTable('core.organisations')
      .set({ name: v.name, country_code: v.countryCode, default_time_zone: v.defaultTimeZone })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}
