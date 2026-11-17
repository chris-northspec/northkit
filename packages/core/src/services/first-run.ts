import { createHash, timingSafeEqual } from 'node:crypto';
import { optionalEnv, setActingUser, sql, withScope, type Db } from '@northkit/db';
import { z } from 'zod';
import { recordAuthEvent } from '../audit';
import { hashPassword, passwordProblem } from '../auth/password';
import { createSession, type RequestInfo } from '../auth/sessions';
import { ConflictError, ForbiddenError, ValidationError } from '../errors';
import { uuidv7 } from '../ids';
import { organisationInputSchema, type OrganisationInput } from './organisation';
import { insertSite, type SiteInput } from './sites';
import { parse } from './validation';

// First-run set-up (S1-7). Copied from NorthCore WMS (S2-11, S3-12) and adapted: it
// also names the organisation. There is no default password anywhere: a fresh install
// has no users, and set-up needs the one-time code deploy/install.sh printed. The new
// administrator must then turn on two-factor sign-in before anything else (their role
// requires it), so the very first session can do nothing but that.

// Any fixed number; held for the length of the set-up transaction so two browsers
// on a fresh install can't both create the first administrator.
const FIRST_RUN_LOCK = 8_510_312;

/** True until the first user exists (archived users count: set-up happens once). */
export async function isFirstRun(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom('core.users')
    .select(sql<boolean>`true`.as('found'))
    .limit(1)
    .executeTakeFirst();
  return !row;
}

const adminSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'Use 100 characters or fewer.'),
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.'),
  password: z.string(),
});

export interface FirstRunInput {
  /** The one-time code from deploy/.env, shown once by deploy/install.sh. */
  setupCode: string;
  organisation: OrganisationInput;
  admin: z.input<typeof adminSchema>;
  site: SiteInput;
}

/** Wrong set-up codes allowed per window before set-up pauses (install-wide). */
export const SETUP_ATTEMPT_LIMIT = 5;
export const SETUP_ATTEMPT_MINUTES = 15;

/** Codes are read out and typed: ignore case, spaces and hyphens. */
const normalise = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

/** Compares in constant time (hashes first, so lengths never leak either). */
export function setupCodeMatches(given: string, expected: string): boolean {
  const digest = (v: string) => createHash('sha256').update(normalise(v)).digest();
  return expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}

const LOCKED =
  'Set-up is locked: this server has no set-up code. Run sh deploy/install.sh --new-setup-code, then restart the web service.';

/**
 * Refuses unless the code matches. Wrong codes are audited and, past the limit in the
 * window, refused outright for everyone until the window passes (rate limit on a
 * public endpoint).
 */
async function checkSetupCode(
  db: Db,
  given: string,
  expected: string | undefined,
  request: RequestInfo,
): Promise<void> {
  if (!expected) throw new ForbiddenError(LOCKED);
  const since = new Date(Date.now() - SETUP_ATTEMPT_MINUTES * 60_000);
  const { count } = await db
    .selectFrom('audit.audit_events')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('action', '=', 'auth.setup_code_failed')
    .where('created_at', '>', since)
    .executeTakeFirstOrThrow();
  if (Number(count) >= SETUP_ATTEMPT_LIMIT)
    throw new ValidationError(
      `Too many wrong set-up codes. Wait ${SETUP_ATTEMPT_MINUTES} minutes and try again.`,
      { setupCode: 'Too many wrong codes.' },
    );
  if (!setupCodeMatches(given, expected)) {
    await db.transaction().execute((tx) =>
      recordAuthEvent(tx, {
        action: 'auth.setup_code_failed',
        userId: null,
        ipAddress: request.ipAddress ?? null,
      }),
    );
    throw new ValidationError('That set-up code isn’t right.', {
      setupCode: 'Check the code shown when NorthKit was installed (it’s in deploy/.env).',
    });
  }
}

/**
 * On an empty database: names the organisation, creates the first administrator (every
 * site, their own password) and the first site, and signs them in. Refused once any user
 * exists, so the code is useless after set-up. `pnpm admin:create` is the fallback.
 */
export async function completeFirstRun(
  db: Db,
  input: FirstRunInput,
  request: RequestInfo = {},
  options: { expectedCode?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  if (!(await isFirstRun(db)))
    throw new ConflictError('Set-up has already been done. Sign in instead.');
  await checkSetupCode(
    db,
    input.setupCode,
    options.expectedCode ?? optionalEnv('NORTHKIT_SETUP_CODE'),
    request,
  );
  // The organisation's fields are reported as organisation.<field>, so they never clash
  // with the site's (both have a name).
  let organisation: z.output<typeof organisationInputSchema>;
  try {
    organisation = parse(organisationInputSchema, input.organisation);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    throw new ValidationError(
      error.message,
      Object.fromEntries(Object.entries(error.fields).map(([k, v]) => [`organisation.${k}`, v])),
    );
  }
  const admin = parse(adminSchema, input.admin);
  const problem = passwordProblem(admin.password, admin.email);
  if (problem) throw new ValidationError(problem, { password: problem });
  const passwordHash = await hashPassword(admin.password);

  const userId = uuidv7();
  const siteId = uuidv7();
  return withScope(db, { siteIds: [siteId], userId }, async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${FIRST_RUN_LOCK})`.execute(tx);
    const existing = await tx.selectFrom('core.users').select('id').limit(1).executeTakeFirst();
    if (existing) throw new ConflictError('Set-up has already been done. Sign in instead.');

    await setActingUser(tx, userId);
    await tx
      .insertInto('core.users')
      .values({
        id: userId,
        email: admin.email,
        display_name: admin.displayName,
        password_hash: passwordHash,
        all_sites: true,
        must_change_password: false,
      })
      .execute();
    await tx
      .insertInto('core.organisations')
      .values({
        name: organisation.name,
        country_code: organisation.countryCode,
        default_time_zone: organisation.defaultTimeZone,
      })
      .execute();
    const role = await tx
      .selectFrom('core.roles')
      .select('id')
      .where('code', '=', 'admin')
      .executeTakeFirstOrThrow();
    await tx.insertInto('core.user_roles').values({ user_id: userId, role_id: role.id }).execute();
    const site = await insertSite(tx, siteId, {
      countryCode: organisation.countryCode,
      timeZone: organisation.defaultTimeZone,
      ...input.site,
    });
    await recordAuthEvent(tx, {
      action: 'auth.first_run_setup',
      userId,
      ipAddress: request.ipAddress ?? null,
      details: { site: site.code },
    });
    await tx
      .updateTable('core.users')
      .set({ last_login_at: new Date() })
      .where('id', '=', userId)
      .execute();
    return createSession(tx, userId, false, request);
  });
}
