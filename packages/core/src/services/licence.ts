import { sql, type Db } from '@northkit/db';
import {
  licenceStatus,
  NORTHSPEC_PUBLIC_KEYS,
  readLicence,
  type LicencePayload,
  type LicenceStatus,
} from '@northkit/licence';
import { requirePermission, type ActorContext } from '../context';
import { ForbiddenError, ValidationError } from '../errors';
import { PRODUCT_VERSION } from '../product';

// S1-7: the licence in force is the newest row of core.licences, verified offline on
// every read. Installing a licence is allowed even when read-only, so a lapsed install
// can always be brought back without anyone touching the database.

export interface LicenceOptions {
  /** Trusted public keys; tests pass throwaway ones. Defaults to NorthSpec's. */
  trustedKeys?: Readonly<Record<string, string>>;
  now?: Date;
}

export interface LicenceView extends LicenceStatus {
  installedAt: Date | null;
}

/** What the licence allows right now. */
export async function currentLicence(db: Db, options: LicenceOptions = {}): Promise<LicenceView> {
  const [latest, organisation] = await Promise.all([
    db
      .selectFrom('core.licences')
      .select(['licence_text', 'created_at'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
    db.selectFrom('core.organisations').select('created_at').executeTakeFirst(),
  ]);
  const status = licenceStatus({
    licenceText: latest?.licence_text ?? null,
    trustedKeys: options.trustedKeys ?? NORTHSPEC_PUBLIC_KEYS,
    productVersion: PRODUCT_VERSION,
    installedAt: organisation?.created_at ?? null,
    ...(options.now ? { now: options.now } : {}),
  });
  return { ...status, installedAt: latest?.created_at ?? null };
}

/**
 * Installs a licence file (Settings, or pnpm licence:install). It must verify against
 * NorthSpec's key; dates aren't checked here, so an expired file can still be
 * installed and shows as lapsed. Runs outside the read-only scope on purpose.
 */
export async function installLicence(
  db: Db,
  actor: ActorContext,
  text: string,
  options: LicenceOptions = {},
): Promise<LicencePayload> {
  requirePermission(actor, 'settings.edit');
  if (!actor.administrator)
    throw new ForbiddenError('Only an administrator can install a licence.');
  return insertLicence(db, text, actor.userId, options);
}

/** Verifies and stores a licence file. For the CLI and installLicence. */
export async function insertLicence(
  db: Db,
  text: string,
  userId: string | null,
  options: LicenceOptions = {},
): Promise<LicencePayload> {
  const read = readLicence(text, options.trustedKeys ?? NORTHSPEC_PUBLIC_KEYS);
  if (!read.ok) throw new ValidationError(read.reason, { licence: read.reason });
  const p = read.payload;
  await db.transaction().execute(async (tx) => {
    if (userId) await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(tx);
    await tx
      .insertInto('core.licences')
      .values({
        licence_text: text.trim(),
        licence_ref: p.licenceRef,
        licensee: p.licensee,
        issued_on: p.issuedOn,
        expires_on: p.expiresOn,
      })
      .execute();
  });
  return p;
}
