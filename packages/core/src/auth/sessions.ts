import { createHash, randomBytes } from 'node:crypto';
import { optionalEnv, setActingUser, sql, type Db, type Tx } from '@northkit/db';
import { recordAuthEvent } from '../audit';
import type { ActorContext } from '../context';
import { currentLicence, type LicenceOptions, type LicenceView } from '../services/licence';
import { PERMISSIONS, isPermission, withImpliedView, type Permission } from './permissions';
import { verifyAgainstDummy, verifyPassword } from './password';
import { openSecret } from './secret-box';
import { verifyTotp } from './totp';

// Copied from NorthCore WMS (14 Nov 2026) and adapted: site scope only, roles can
// require two-factor sign-in, and the licence's read-only state reaches every actor.

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;
/** How long someone has to type their two-factor code after a correct password. */
export const MFA_PENDING_MINUTES = 10;

export function sessionSettings() {
  return {
    idleMinutes: Number(optionalEnv('NORTHKIT_SESSION_IDLE_MINUTES') ?? 720),
    absoluteHours: Number(optionalEnv('NORTHKIT_SESSION_ABSOLUTE_HOURS') ?? 24),
  };
}

export type SignInResult =
  | { kind: 'signed_in'; token: string; expiresAt: Date }
  | { kind: 'mfa_required'; token: string; expiresAt: Date }
  | { kind: 'invalid' }
  | { kind: 'locked'; until: Date };

export interface RequestInfo {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

const minutesFrom = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

export async function createSession(
  tx: Tx,
  userId: string,
  mfaPending: boolean,
  request: RequestInfo,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = mfaPending
    ? minutesFrom(now, MFA_PENDING_MINUTES)
    : minutesFrom(now, sessionSettings().absoluteHours * 60);
  await tx
    .insertInto('core.sessions')
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      mfa_pending: mfaPending,
      expires_at: expiresAt,
      ip_address: request.ipAddress ?? null,
      user_agent: request.userAgent?.slice(0, 500) ?? null,
    })
    .execute();
  return { token, expiresAt };
}

/** Counts a failed password or code; the fifth in a row locks the account. */
export async function registerFailure(
  tx: Tx,
  user: { id: string; failed_login_count: number },
): Promise<{ lockedUntil: Date | null }> {
  const failures = user.failed_login_count + 1;
  if (failures >= LOCKOUT_THRESHOLD) {
    const lockedUntil = minutesFrom(new Date(), LOCKOUT_MINUTES);
    await tx
      .updateTable('core.users')
      .set({ failed_login_count: 0, locked_until: lockedUntil })
      .where('id', '=', user.id)
      .execute();
    return { lockedUntil };
  }
  await tx
    .updateTable('core.users')
    .set({ failed_login_count: failures })
    .where('id', '=', user.id)
    .execute();
  return { lockedUntil: null };
}

/**
 * Checks an email and password. The same 'invalid' answer covers an unknown email,
 * an archived account and a wrong password, so the form can't be used to find
 * accounts. The user row is locked (FOR NO KEY UPDATE, see NorthCore S3-15) so
 * parallel guesses all count.
 */
export async function signIn(
  db: Db,
  credentials: { email: string; password: string },
  request: RequestInfo = {},
): Promise<SignInResult> {
  return db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('core.users')
      .select(['id', 'password_hash', 'failed_login_count', 'locked_until', 'mfa_enabled_at'])
      .where(sql<string>`lower(email)`, '=', credentials.email.trim().toLowerCase())
      .where('archived_at', 'is', null)
      .forNoKeyUpdate()
      .executeTakeFirst();
    const ipAddress = request.ipAddress ?? null;
    if (!user?.password_hash) {
      await verifyAgainstDummy(credentials.password);
      await recordAuthEvent(tx, { action: 'auth.sign_in_failed', userId: null, ipAddress });
      return { kind: 'invalid' as const };
    }
    await setActingUser(tx, user.id);

    if (user.locked_until && user.locked_until > new Date()) {
      await recordAuthEvent(tx, {
        action: 'auth.sign_in_refused_locked',
        userId: user.id,
        ipAddress,
      });
      return { kind: 'locked' as const, until: user.locked_until };
    }
    if (!(await verifyPassword(user.password_hash, credentials.password))) {
      const { lockedUntil } = await registerFailure(tx, user);
      await recordAuthEvent(tx, {
        action: lockedUntil ? 'auth.account_locked' : 'auth.sign_in_failed',
        userId: user.id,
        ipAddress,
      });
      return lockedUntil
        ? { kind: 'locked' as const, until: lockedUntil }
        : { kind: 'invalid' as const };
    }

    await tx
      .updateTable('core.users')
      .set({ failed_login_count: 0, locked_until: null })
      .where('id', '=', user.id)
      .execute();
    if (user.mfa_enabled_at) {
      return {
        kind: 'mfa_required' as const,
        ...(await createSession(tx, user.id, true, request)),
      };
    }
    await tx
      .updateTable('core.users')
      .set({ last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    await recordAuthEvent(tx, { action: 'auth.sign_in', userId: user.id, ipAddress });
    return { kind: 'signed_in' as const, ...(await createSession(tx, user.id, false, request)) };
  });
}

/**
 * Second step for users with two-factor sign-in. On success the pending session
 * is replaced by a new one with a new token (no session fixation). Wrong codes
 * count towards the same lockout as wrong passwords.
 */
export async function completeMfa(
  db: Db,
  pendingToken: string,
  code: string,
  request: RequestInfo = {},
): Promise<SignInResult> {
  return db.transaction().execute(async (tx) => {
    const pending = await tx
      .selectFrom('core.sessions')
      .select(['id', 'user_id'])
      .where('token_hash', '=', hashToken(pendingToken))
      .where('mfa_pending', '=', true)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!pending) return { kind: 'invalid' as const };
    const user = await tx
      .selectFrom('core.users')
      .select([
        'id',
        'failed_login_count',
        'locked_until',
        'mfa_secret_encrypted',
        'mfa_last_used_step',
      ])
      .where('id', '=', pending.user_id)
      .where('archived_at', 'is', null)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!user?.mfa_secret_encrypted) return { kind: 'invalid' as const };
    await setActingUser(tx, user.id);
    const endPending = () =>
      tx
        .updateTable('core.sessions')
        .set({ revoked_at: new Date() })
        .where('id', '=', pending.id)
        .execute();

    if (user.locked_until && user.locked_until > new Date()) {
      await endPending();
      return { kind: 'locked' as const, until: user.locked_until };
    }
    const step = verifyTotp(openSecret(user.mfa_secret_encrypted), code, user.mfa_last_used_step);
    const ipAddress = request.ipAddress ?? null;
    if (step === null) {
      const { lockedUntil } = await registerFailure(tx, user);
      await recordAuthEvent(tx, {
        action: lockedUntil ? 'auth.account_locked' : 'auth.mfa_failed',
        userId: user.id,
        ipAddress,
      });
      if (!lockedUntil) return { kind: 'invalid' as const };
      await endPending();
      return { kind: 'locked' as const, until: lockedUntil };
    }

    await endPending();
    await tx
      .updateTable('core.users')
      .set({ mfa_last_used_step: step, failed_login_count: 0, last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    await recordAuthEvent(tx, {
      action: 'auth.sign_in',
      userId: user.id,
      ipAddress,
      details: { two_factor: true },
    });
    return { kind: 'signed_in' as const, ...(await createSession(tx, user.id, false, request)) };
  });
}

export interface SignedInUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  /** Holds a role that requires two-factor sign-in, which isn't on yet. */
  mfaSetupRequired: boolean;
  /** Site the site filter opens on without a remembered choice; null for all their sites. */
  homeSiteId: string | null;
}

export interface ActiveSession {
  sessionId: string;
  user: SignedInUser;
  actor: ActorContext;
  licence: LicenceView;
}

interface RoleRow {
  permissions: string[];
  full_access: boolean;
  site_scope: 'all' | 'listed';
  requires_mfa: boolean;
}

async function liveRoles(tx: Tx, userId: string): Promise<RoleRow[]> {
  return tx
    .selectFrom('core.user_roles as ur')
    .innerJoin('core.roles as r', 'r.id', 'ur.role_id')
    .select(['r.permissions', 'r.full_access', 'r.site_scope', 'r.requires_mfa'])
    .where('ur.user_id', '=', userId)
    .where('r.archived_at', 'is', null)
    .execute();
}

/**
 * The actor for a user: permissions are the union of their live roles' permissions
 * (everything for an Administrator); sites come from accessible_site_ids, which
 * already narrows the user's own assignment by their roles' site scopes.
 */
export async function loadActor(
  tx: Tx,
  userId: string,
  user: { allSites: boolean },
  options: { readOnly?: boolean; roles?: RoleRow[] } = {},
): Promise<ActorContext> {
  const roles = options.roles ?? (await liveRoles(tx, userId));
  const administrator = roles.some((role) => role.full_access);
  const permissions = new Set<Permission>(
    administrator
      ? PERMISSIONS
      : withImpliedView(roles.flatMap((role) => role.permissions).filter(isPermission)),
  );
  const { rows } = await sql<{
    site_ids: string[];
  }>`SELECT core.accessible_site_ids(${userId}) AS site_ids`.execute(tx);
  return {
    userId,
    siteIds: rows[0]?.site_ids ?? [],
    allSites: administrator || (user.allSites && roles.some((role) => role.site_scope === 'all')),
    administrator,
    permissions,
    readOnly: options.readOnly ?? false,
  };
}

/**
 * The actor for a session that may do nothing yet: a password still to change, or
 * two-factor still to set up. No permissions and no sites, so every service and RLS
 * check refuses.
 */
export function emptyActor(userId: string): ActorContext {
  return {
    userId,
    siteIds: [],
    allSites: false,
    administrator: false,
    permissions: new Set<Permission>(),
    readOnly: true,
  };
}

/**
 * Resolves a session cookie to the signed-in user and their actor context, or null
 * if the session is unknown, revoked, still waiting for a two-factor code, past its
 * absolute end, idle too long, or the user has been archived.
 */
export async function getSession(
  db: Db,
  token: string,
  licenceOptions: LicenceOptions = {},
): Promise<ActiveSession | null> {
  if (!token) return null;
  const { idleMinutes } = sessionSettings();
  const licence = await currentLicence(db, licenceOptions);
  return db.transaction().execute(async (tx) => {
    const now = new Date();
    const row = await tx
      .selectFrom('core.sessions as s')
      .innerJoin('core.users as u', 'u.id', 's.user_id')
      .select([
        's.id as session_id',
        's.last_seen_at',
        'u.id as user_id',
        'u.email',
        'u.display_name',
        'u.must_change_password',
        'u.mfa_enabled_at',
        'u.all_sites',
        'u.home_site_id',
      ])
      .where('s.token_hash', '=', hashToken(token))
      .where('s.mfa_pending', '=', false)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', now)
      .where('s.last_seen_at', '>', minutesFrom(now, -idleMinutes))
      .where('u.archived_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    // Only write when it matters for the idle timeout, not on every request.
    if (now.getTime() - row.last_seen_at.getTime() > 60_000) {
      await setActingUser(tx, row.user_id);
      await tx
        .updateTable('core.sessions')
        .set({ last_seen_at: now })
        .where('id', '=', row.session_id)
        .execute();
    }
    const roles = await liveRoles(tx, row.user_id);
    const mfaSetupRequired = row.mfa_enabled_at === null && roles.some((r) => r.requires_mfa);
    // Until an issued password is replaced, or a required second factor is set up, the
    // session can do one thing: that. No permissions and no sites.
    const actor =
      row.must_change_password || mfaSetupRequired
        ? emptyActor(row.user_id)
        : await loadActor(
            tx,
            row.user_id,
            { allSites: row.all_sites },
            { readOnly: licence.readOnly, roles },
          );
    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        mustChangePassword: row.must_change_password,
        mfaEnabled: row.mfa_enabled_at !== null,
        mfaSetupRequired,
        homeSiteId: row.home_site_id,
      },
      actor,
      licence,
    };
  });
}

export async function signOut(db: Db, token: string, request: RequestInfo = {}): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const ended = await tx
      .updateTable('core.sessions')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', hashToken(token))
      .where('revoked_at', 'is', null)
      .returning('user_id')
      .executeTakeFirst();
    if (!ended) return;
    await setActingUser(tx, ended.user_id);
    await recordAuthEvent(tx, {
      action: 'auth.sign_out',
      userId: ended.user_id,
      ipAddress: request.ipAddress ?? null,
    });
  });
}

/**
 * Ends every live session for a user (password reset, archive, two-factor change),
 * except `keepSessionId` when the user is changing their own settings. Returns how
 * many sessions it ended.
 */
export async function revokeUserSessions(
  tx: Tx,
  userId: string,
  keepSessionId?: string,
): Promise<number> {
  let query = tx
    .updateTable('core.sessions')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (keepSessionId) query = query.where('id', '<>', keepSessionId);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Re-asks for the password before a signed-in user changes their security settings. */
export async function checkPassword(db: Db, userId: string, password: string): Promise<boolean> {
  const user = await db
    .selectFrom('core.users')
    .select('password_hash')
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user?.password_hash) return verifyAgainstDummy(password);
  return verifyPassword(user.password_hash, password);
}
