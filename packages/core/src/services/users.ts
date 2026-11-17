import { randomBytes } from 'node:crypto';
import { setActingUser, withScope, sql, type Db, type Tx, type User } from '@northkit/db';
import { z } from 'zod';
import { recordAuthEvent } from '../audit';
import type { Permission } from '../auth/permissions';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { openSecret, sealSecret } from '../auth/secret-box';
import { registerFailure, revokeUserSessions, type RequestInfo } from '../auth/sessions';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../auth/totp';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { PRODUCT_NAME } from '../product';
import { isUniqueViolation, parse } from './validation';

// Copied from NorthCore WMS (users.ts and user-admin.ts, 14 Nov 2026) and adapted:
// site assignment only, a phone number, and two-factor that can't be turned off
// while a role requires it.

/** User fields safe to hand to the web layer: no hash, no two-factor secret. */
export type UserSummary = Pick<
  User,
  | 'id'
  | 'email'
  | 'display_name'
  | 'phone'
  | 'all_sites'
  | 'mfa_enabled_at'
  | 'locked_until'
  | 'last_login_at'
  | 'must_change_password'
  | 'archived_at'
  | 'row_version'
>;
const SUMMARY_COLUMNS = [
  'id',
  'email',
  'display_name',
  'phone',
  'all_sites',
  'mfa_enabled_at',
  'locked_until',
  'last_login_at',
  'must_change_password',
  'archived_at',
  'row_version',
] as const;

export interface UserRow extends UserSummary {
  roles: { code: string; name: string }[];
  /** Sites in the actor's scope that the user is assigned to. */
  siteIds: string[];
}

const uuid = z.string().uuid();
const userFields = {
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.'),
  displayName: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Use 40 characters or fewer.')
    .transform((v) => v || null)
    .nullable()
    .default(null),
};

const accessFields = {
  roles: z.array(z.string()).default([]),
  allSites: z.boolean().default(false),
  siteIds: z.array(uuid).default([]),
};

export const newUserSchema = z.object({
  ...userFields,
  ...accessFields,
  // Left out, it follows the roles (defaultAllSites).
  allSites: z.boolean().optional(),
  password: z.string(),
});
export type NewUserInput = z.input<typeof newUserSchema>;

export const userUpdateSchema = z.object(userFields);
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export const userAccessSchema = z.object(accessFields);
export type UserAccessInput = z.input<typeof userAccessSchema>;

function checkNewPassword(password: string, email: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw new ValidationError(problem, { password: problem });
}

/** The database's last-administrator constraint (migration 0002), as a message. */
export function isLastAdministratorError(error: unknown): boolean {
  return (error as { constraint?: unknown } | null)?.constraint === 'one_active_administrator';
}

/** Rethrows the last-administrator constraint as a validation message. */
export function lastAdministratorGuard(error: unknown): never {
  if (isLastAdministratorError(error))
    throw new ValidationError(
      'At least one active administrator must remain. Make someone else an administrator first.',
    );
  throw error;
}

async function isAdministrator(tx: Tx, userId: string): Promise<boolean> {
  const row = await tx
    .selectFrom('core.user_roles as ur')
    .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
    .select('r.id')
    .where('ur.user_id', '=', userId)
    .where('r.full_access', '=', true)
    .executeTakeFirst();
  return Boolean(row);
}

/** Only an administrator may change, archive or reset another administrator. */
async function guardAdministratorTarget(tx: Tx, actor: ActorContext, userId: string) {
  if (!actor.administrator && (await isAdministrator(tx, userId)))
    throw new ForbiddenError('Only an administrator can change another administrator.');
}

/**
 * Sets a user's roles. Refuses roles that don't exist or are archived, the
 * Administrator role unless the actor is an administrator, and any role carrying a
 * permission the actor doesn't hold (no one gives away more than they have).
 */
async function replaceRoles(
  tx: Tx,
  actor: ActorContext,
  userId: string,
  roleCodes: readonly string[],
): Promise<void> {
  const roles = roleCodes.length
    ? await tx
        .selectFrom('core.roles')
        .select(['id', 'code', 'full_access', 'permissions'])
        .where('code', 'in', [...roleCodes])
        .where('archived_at', 'is', null)
        .execute()
    : [];
  const unknown = roleCodes.filter((code) => !roles.some((role) => role.code === code));
  if (unknown.length)
    throw new ValidationError(`Unknown role: ${unknown.join(', ')}`, { roles: 'Unknown role.' });
  const current = await tx
    .selectFrom('core.user_roles')
    .select('role_id')
    .where('user_id', '=', userId)
    .execute();
  const currentIds = new Set(current.map((r) => r.role_id));
  for (const role of roles) {
    if (currentIds.has(role.id)) continue; // keeping a role is never an escalation
    if (role.full_access && !actor.administrator)
      throw new ForbiddenError('Only an administrator can make someone an administrator.');
    if (role.permissions.some((p) => !actor.permissions.has(p as Permission)))
      throw new ForbiddenError('You can’t give someone a role with permissions you don’t have.');
  }
  const keep = new Set(roles.map((r) => r.id));
  const remove = [...currentIds].filter((id) => !keep.has(id));
  if (remove.length)
    await tx
      .deleteFrom('core.user_roles')
      .where('user_id', '=', userId)
      .where('role_id', 'in', remove)
      .execute();
  const add = roles.filter((r) => !currentIds.has(r.id));
  if (add.length)
    await tx
      .insertInto('core.user_roles')
      .values(add.map((role) => ({ user_id: userId, role_id: role.id })))
      .execute();
}

/**
 * Sets the sites a user works at, within the actor's own sites: assignments at sites
 * the actor can't see are left exactly as they are (RLS hides them). Every-site
 * access can only be granted by someone who has it.
 */
async function replaceSites(
  tx: Tx,
  actor: ActorContext,
  userId: string,
  allSites: boolean,
  siteIds: readonly string[],
): Promise<void> {
  const outside = siteIds.filter((id) => !actor.siteIds.includes(id));
  if (outside.length)
    throw new ValidationError('Check the highlighted fields.', { siteIds: 'Unknown site.' });
  const current = await tx
    .selectFrom('core.users')
    .select('all_sites')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (allSites !== current.all_sites) {
    if (!actor.allSites)
      throw new ForbiddenError('Only users who work at every site can change every-site access.');
    await tx
      .updateTable('core.users')
      .set({ all_sites: allSites })
      .where('id', '=', userId)
      .execute();
  }
  const existing = await tx
    .selectFrom('core.user_sites')
    .select('site_id')
    .where('user_id', '=', userId)
    .execute();
  const have = new Set(existing.map((r) => r.site_id));
  const want = new Set(siteIds);
  const remove = [...have].filter((id) => !want.has(id));
  if (remove.length)
    await tx
      .deleteFrom('core.user_sites')
      .where('user_id', '=', userId)
      .where('site_id', 'in', remove)
      .execute();
  const add = [...want].filter((id) => !have.has(id));
  if (add.length)
    await tx
      .insertInto('core.user_sites')
      .values(add.map((site_id) => ({ user_id: userId, site_id })))
      .execute();
}

async function rowsFor(tx: Tx, users: UserSummary[]): Promise<UserRow[]> {
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);
  const [roles, sites] = await Promise.all([
    tx
      .selectFrom('core.user_roles as ur')
      .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
      .select(['ur.user_id', 'r.code', 'r.name'])
      .where('ur.user_id', 'in', ids)
      .where('r.archived_at', 'is', null)
      .orderBy('r.name')
      .execute(),
    tx
      .selectFrom('core.user_sites')
      .select(['user_id', 'site_id'])
      .where('user_id', 'in', ids)
      .execute(),
  ]);
  return users.map((u) => ({
    ...u,
    roles: roles.filter((r) => r.user_id === u.id).map(({ code, name }) => ({ code, name })),
    siteIds: sites.filter((s) => s.user_id === u.id).map((s) => s.site_id),
  }));
}

export async function listUsers(
  db: Db,
  actor: ActorContext,
  options: { includeArchived?: boolean } = {},
): Promise<UserRow[]> {
  requirePermission(actor, 'users.view');
  return withScope(db, scopeOf(actor), async (tx) => {
    let q = tx.selectFrom('core.users').select(SUMMARY_COLUMNS).orderBy('display_name');
    if (!options.includeArchived) q = q.where('archived_at', 'is', null);
    return rowsFor(tx, await q.execute());
  });
}

export async function getUser(db: Db, actor: ActorContext, userId: string): Promise<UserRow> {
  requirePermission(actor, 'users.view');
  return withScope(db, scopeOf(actor), async (tx) => {
    const user = await tx
      .selectFrom('core.users')
      .select(SUMMARY_COLUMNS)
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User not found.');
    return (await rowsFor(tx, [user]))[0]!;
  });
}

/**
 * Live users' names only, for pickers such as a site's manager. Anyone who can edit
 * locations or settings, or see users may list them; nothing else about the users is returned.
 */
export async function userChoices(
  db: Db,
  actor: ActorContext,
): Promise<{ id: string; displayName: string }[]> {
  if (
    !actor.permissions.has('locations.create') &&
    !actor.permissions.has('settings.create') &&
    !actor.permissions.has('settings.edit') &&
    !actor.permissions.has('users.view')
  )
    throw new ForbiddenError('You do not have permission to do that.');
  const rows = await withScope(db, scopeOf(actor), (tx) =>
    tx
      .selectFrom('core.users')
      .select(['id', 'display_name'])
      .where('archived_at', 'is', null)
      .orderBy('display_name')
      .execute(),
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
}

/**
 * Seeded roles whose holders work across every depot: a new user given one of them
 * works at every site unless whoever adds them says otherwise (B-2). The Administrator
 * sees every site anyway; every-site access also lets them grant it and add sites.
 */
export const ALL_SITES_ROLE_CODES: readonly string[] = ['admin', 'kit_manager'];

/** Every-site access for a new user whose adder didn't choose: on for organisation-wide roles. */
export function defaultAllSites(roleCodes: readonly string[]): boolean {
  return roleCodes.some((code) => ALL_SITES_ROLE_CODES.includes(code));
}

/** A new user with a temporary password they must change at first sign-in. */
export async function createUser(
  db: Db,
  actor: ActorContext,
  input: NewUserInput,
): Promise<UserSummary> {
  requirePermission(actor, 'users.create');
  const values = parse(newUserSchema, input);
  checkNewPassword(values.password, values.email);
  const passwordHash = await hashPassword(values.password);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const user = await tx
        .insertInto('core.users')
        .values({
          email: values.email,
          display_name: values.displayName,
          phone: values.phone,
          password_hash: passwordHash,
          must_change_password: true,
        })
        .returning(SUMMARY_COLUMNS)
        .executeTakeFirstOrThrow();
      // Only someone with every-site access can give it, so the default is off for others.
      const allSites = values.allSites ?? (actor.allSites && defaultAllSites(values.roles));
      await replaceRoles(tx, actor, user.id, values.roles);
      await replaceSites(tx, actor, user.id, allSites, values.siteIds);
      return { ...user, all_sites: allSites };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A user with that email already exists.');
    throw error;
  }
}

export async function updateUser(
  db: Db,
  actor: ActorContext,
  userId: string,
  rowVersion: number,
  input: UserUpdateInput,
): Promise<UserSummary> {
  requirePermission(actor, 'users.edit');
  const values = parse(userUpdateSchema, input);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      await guardAdministratorTarget(tx, actor, userId);
      const updated = await tx
        .updateTable('core.users')
        .set({ email: values.email, display_name: values.displayName, phone: values.phone })
        .where('id', '=', userId)
        .where('row_version', '=', rowVersion)
        .returning(SUMMARY_COLUMNS)
        .executeTakeFirst();
      if (updated) return updated;
      const exists = await tx
        .selectFrom('core.users')
        .select('id')
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!exists) throw new NotFoundError('User not found.');
      throw new ConflictError('Someone else changed this user. Reload and try again.');
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A user with that email already exists.');
    throw error;
  }
}

/** Roles and sites together: the user's access. Nobody changes their own. */
export async function setUserAccess(
  db: Db,
  actor: ActorContext,
  userId: string,
  input: UserAccessInput,
): Promise<void> {
  requirePermission(actor, 'users.edit');
  if (userId === actor.userId) throw new ForbiddenError('You can’t change your own access.');
  const values = parse(userAccessSchema, input);
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      const exists = await tx
        .selectFrom('core.users')
        .select('id')
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!exists) throw new NotFoundError('User not found.');
      await guardAdministratorTarget(tx, actor, userId);
      await replaceRoles(tx, actor, userId, values.roles);
      await replaceSites(tx, actor, userId, values.allSites, values.siteIds);
    });
  } catch (error) {
    lastAdministratorGuard(error);
  }
}

/** Archives a user and ends their sessions. Nobody can archive themselves. */
export async function archiveUser(
  db: Db,
  actor: ActorContext,
  userId: string,
  rowVersion: number,
): Promise<void> {
  requirePermission(actor, 'users.edit');
  if (userId === actor.userId) throw new ValidationError('You can’t archive your own account.');
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      await guardAdministratorTarget(tx, actor, userId);
      const result = await tx
        .updateTable('core.users')
        .set({ archived_at: new Date() })
        .where('id', '=', userId)
        .where('row_version', '=', rowVersion)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n)
        throw new ConflictError('That user was changed or archived already. Reload and try again.');
      await revokeUserSessions(tx, userId);
    });
  } catch (error) {
    lastAdministratorGuard(error);
  }
}

export async function restoreUser(
  db: Db,
  actor: ActorContext,
  userId: string,
  rowVersion: number,
): Promise<void> {
  requirePermission(actor, 'users.edit');
  await withScope(db, scopeOf(actor), async (tx) => {
    await guardAdministratorTarget(tx, actor, userId);
    const result = await tx
      .updateTable('core.users')
      .set({ archived_at: null })
      .where('id', '=', userId)
      .where('row_version', '=', rowVersion)
      .where('archived_at', 'is not', null)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n)
      throw new ConflictError('That user was changed or restored already. Reload and try again.');
  });
}

/** A random password to read out or hand over: 4 groups of 4, no look-alike characters. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * An admin sets a new password; the user must change it at next sign-in, any
 * lockout is cleared and their sessions end.
 */
export async function resetPassword(
  db: Db,
  actor: ActorContext,
  userId: string,
  newPassword: string,
): Promise<void> {
  requirePermission(actor, 'users.edit');
  if (userId === actor.userId)
    throw new ValidationError('Change your own password from your account page.');
  await withScope(db, scopeOf(actor), async (tx) => {
    await guardAdministratorTarget(tx, actor, userId);
    const user = await tx
      .selectFrom('core.users')
      .select(['id', 'email'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User not found.');
    checkNewPassword(newPassword, user.email);
    await tx
      .updateTable('core.users')
      .set({
        password_hash: await hashPassword(newPassword),
        must_change_password: true,
        failed_login_count: 0,
        locked_until: null,
      })
      .where('id', '=', userId)
      .execute();
    await revokeUserSessions(tx, userId);
  });
}

// ---------------------------------------------------------------- self-service security

async function loadOwnRow(tx: Tx, userId: string) {
  const user = await tx
    .selectFrom('core.users')
    .select([
      'id',
      'email',
      'password_hash',
      'mfa_secret_encrypted',
      'mfa_enabled_at',
      'mfa_last_used_step',
      'failed_login_count',
      'locked_until',
    ])
    .where('id', '=', userId)
    .where('archived_at', 'is', null)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (!user) throw new NotFoundError('User not found.');
  return user;
}

type OwnRow = Awaited<ReturnType<typeof loadOwnRow>>;

/** Thrown after the transaction commits, so a failed check still counts towards lockout. */
interface CheckFailure {
  failure: ValidationError;
}

/**
 * A wrong password or code on a security screen counts like a failed sign-in: the
 * fifth in a row locks the account and ends every session.
 */
async function failCheck(
  tx: Tx,
  user: OwnRow,
  message: string,
  fields: Record<string, string>,
): Promise<CheckFailure> {
  const { lockedUntil } = await registerFailure(tx, user);
  if (lockedUntil) {
    await revokeUserSessions(tx, user.id);
    await recordAuthEvent(tx, { action: 'auth.account_locked', userId: user.id });
    return {
      failure: new ValidationError(
        'Too many wrong attempts. You have been signed out; try again in 15 minutes.',
      ),
    };
  }
  return { failure: new ValidationError(message, fields) };
}

const isFailure = (value: unknown): value is CheckFailure =>
  typeof value === 'object' && value !== null && 'failure' in value;

/**
 * Runs a self-service security change, throwing any check failure after commit. Not
 * read-only when the licence lapses: people can always secure their own account.
 */
async function ownChange<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx, user: OwnRow) => Promise<T | CheckFailure>,
): Promise<T> {
  const result = await db.transaction().execute(async (tx) => {
    await setActingUser(tx, userId);
    const user = await loadOwnRow(tx, userId);
    if (user.locked_until && user.locked_until > new Date()) {
      return {
        failure: new ValidationError('Your account is locked for now. Try again in 15 minutes.'),
      };
    }
    return fn(tx, user);
  });
  if (isFailure(result)) throw result.failure;
  return result;
}

/** Where a signed-in user's own security change came from. */
export interface OwnChange extends RequestInfo {
  /** The session making the change; it stays signed in while every other one ends. */
  sessionId?: string;
}

/**
 * A user changes their own password: the current one is required, the new one must
 * differ, the must-change flag clears and every other session ends.
 */
export async function changeOwnPassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
  change: OwnChange = {},
): Promise<void> {
  await ownChange(db, userId, async (tx, user) => {
    if (!user.password_hash || !(await verifyPassword(user.password_hash, currentPassword))) {
      return failCheck(tx, user, 'Your current password is not right.', {
        currentPassword: 'Not right.',
      });
    }
    checkNewPassword(newPassword, user.email);
    if (await verifyPassword(user.password_hash, newPassword)) {
      throw new ValidationError('Choose a password you haven’t used here.', {
        newPassword: 'Same as before.',
      });
    }
    await tx
      .updateTable('core.users')
      .set({
        password_hash: await hashPassword(newPassword),
        must_change_password: false,
        failed_login_count: 0,
      })
      .where('id', '=', userId)
      .execute();
    const ended = await revokeUserSessions(tx, userId, change.sessionId);
    await recordAuthEvent(tx, {
      action: 'auth.password_changed',
      userId,
      ipAddress: change.ipAddress ?? null,
      details: { other_sessions_ended: ended },
    });
  });
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  /** A role this user holds requires two-factor sign-in, so it can't be turned off. */
  required: boolean;
  /** Set-up started but not confirmed: the key to show again. */
  pending: { secret: string; uri: string } | null;
}

async function mfaRequiredFor(tx: Tx | Db, userId: string): Promise<boolean> {
  const row = await tx
    .selectFrom('core.user_roles as ur')
    .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
    .select('r.id')
    .where('ur.user_id', '=', userId)
    .where('r.requires_mfa', '=', true)
    .where('r.archived_at', 'is', null)
    .executeTakeFirst();
  return Boolean(row);
}

/** Two-factor state for the account page. Only ever shown to the user themselves. */
export async function getMfaStatus(db: Db, userId: string): Promise<MfaStatus> {
  const user = await db
    .selectFrom('core.users')
    .select(['email', 'mfa_secret_encrypted', 'mfa_enabled_at'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) throw new NotFoundError('User not found.');
  const required = await mfaRequiredFor(db, userId);
  if (user.mfa_enabled_at)
    return { enabled: true, enabledAt: user.mfa_enabled_at, required, pending: null };
  if (!user.mfa_secret_encrypted)
    return { enabled: false, enabledAt: null, required, pending: null };
  const secret = openSecret(user.mfa_secret_encrypted);
  return {
    enabled: false,
    enabledAt: null,
    required,
    pending: { secret, uri: otpauthUri(secret, user.email, PRODUCT_NAME) },
  };
}

/**
 * Starts two-factor set-up: stores a new (sealed) secret, not yet active, and returns
 * it for the authenticator app. Nothing changes at sign-in until confirmMfa accepts a
 * code made from it.
 */
export async function beginMfaEnrolment(
  db: Db,
  userId: string,
): Promise<{ secret: string; uri: string }> {
  return ownChange(db, userId, async (tx, user) => {
    if (user.mfa_enabled_at) throw new ConflictError('Two-factor sign-in is already on.');
    const secret = generateTotpSecret();
    await tx
      .updateTable('core.users')
      .set({ mfa_secret_encrypted: sealSecret(secret) })
      .where('id', '=', userId)
      .execute();
    return { secret, uri: otpauthUri(secret, user.email, PRODUCT_NAME) };
  });
}

/** Turns two-factor on once a code from the new secret matches. */
export async function confirmMfa(
  db: Db,
  userId: string,
  code: string,
  change: OwnChange = {},
): Promise<void> {
  await ownChange(db, userId, async (tx, user) => {
    if (!user.mfa_secret_encrypted || user.mfa_enabled_at)
      throw new ConflictError('Start two-factor set-up first.');
    const step = verifyTotp(openSecret(user.mfa_secret_encrypted), code, null);
    if (step === null)
      return failCheck(
        tx,
        user,
        'That code didn’t match. Check the time on your phone and try again.',
        { code: 'Not right.' },
      );
    await tx
      .updateTable('core.users')
      .set({ mfa_enabled_at: sql<Date>`now()`, mfa_last_used_step: step, failed_login_count: 0 })
      .where('id', '=', userId)
      .execute();
    const ended = await revokeUserSessions(tx, userId, change.sessionId);
    await recordAuthEvent(tx, {
      action: 'auth.mfa_enabled',
      userId,
      ipAddress: change.ipAddress ?? null,
      details: { other_sessions_ended: ended },
    });
  });
}

/**
 * Turns two-factor off: needs the password and a current code, and is refused while
 * the user holds a role that requires it (the Administrator always does).
 */
export async function disableMfa(
  db: Db,
  userId: string,
  currentPassword: string,
  code: string,
  change: OwnChange = {},
): Promise<void> {
  await ownChange(db, userId, async (tx, user) => {
    if (!user.mfa_enabled_at || !user.mfa_secret_encrypted)
      throw new ConflictError('Two-factor sign-in is already off.');
    if (await mfaRequiredFor(tx, userId))
      throw new ForbiddenError('Your role requires two-factor sign-in, so it can’t be turned off.');
    if (!user.password_hash || !(await verifyPassword(user.password_hash, currentPassword))) {
      return failCheck(tx, user, 'Your current password is not right.', {
        currentPassword: 'Not right.',
      });
    }
    const lastStep = user.mfa_last_used_step === null ? null : Number(user.mfa_last_used_step);
    const step = verifyTotp(openSecret(user.mfa_secret_encrypted), code, lastStep);
    if (step === null) {
      return failCheck(tx, user, 'That code didn’t work. Use a new code from your app.', {
        code: 'Not right.',
      });
    }
    await tx
      .updateTable('core.users')
      .set({
        mfa_enabled_at: null,
        mfa_secret_encrypted: null,
        mfa_last_used_step: null,
        failed_login_count: 0,
      })
      .where('id', '=', userId)
      .execute();
    const ended = await revokeUserSessions(tx, userId, change.sessionId);
    await recordAuthEvent(tx, {
      action: 'auth.mfa_disabled',
      userId,
      ipAddress: change.ipAddress ?? null,
      details: { other_sessions_ended: ended },
    });
  });
}

/**
 * An administrator turns two-factor off for someone who lost their phone. Their
 * sessions end; they sign in with their password and set it up again (straight away,
 * if their role requires it).
 */
export async function resetUserMfa(db: Db, actor: ActorContext, userId: string): Promise<void> {
  requirePermission(actor, 'users.edit');
  if (userId === actor.userId)
    throw new ValidationError('Ask another administrator to reset your two-factor sign-in.');
  await withScope(db, scopeOf(actor), async (tx) => {
    await guardAdministratorTarget(tx, actor, userId);
    const user = await tx
      .updateTable('core.users')
      .set({ mfa_enabled_at: null, mfa_secret_encrypted: null, mfa_last_used_step: null })
      .where('id', '=', userId)
      .where('archived_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User not found.');
    await revokeUserSessions(tx, userId);
    await recordAuthEvent(tx, {
      action: 'auth.mfa_reset',
      userId,
      details: { reset_by: actor.userId },
    });
  });
}

/**
 * The site the signed-in user's site filter opens on when the browser remembers no
 * choice (B-2): one of their own sites, or null for all of them. Like the notification
 * settings it is the user's own, so it can be changed while the licence is read-only.
 * Audited through core.users.
 */
export async function setHomeSite(
  db: Db,
  actor: ActorContext,
  siteId: string | null,
): Promise<void> {
  if (siteId !== null && !actor.siteIds.includes(siteId))
    throw new ValidationError('Choose one of your sites.', {
      homeSiteId: 'Choose one of your sites.',
    });
  await withScope(db, { ...scopeOf(actor), readOnly: false }, (tx) =>
    tx
      .updateTable('core.users')
      .set({ home_site_id: siteId })
      .where('id', '=', actor.userId)
      .execute(),
  );
}
