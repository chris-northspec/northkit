import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/password';
import { openSecret, sealSecret } from '../src/auth/secret-box';
import {
  completeMfa,
  getSession,
  LOCKOUT_THRESHOLD,
  signIn,
  signOut,
  type SignInResult,
} from '../src/auth/sessions';
import { base32Encode, totpCode, totpStep, verifyTotp } from '../src/auth/totp';
import { ForbiddenError } from '../src/errors';
import {
  archiveUser,
  beginMfaEnrolment,
  confirmMfa,
  disableMfa,
  getMfaStatus,
  resetUserMfa,
} from '../src/services/users';
import { listSites } from '../src/services/sites';
import { fixtures, PASSWORD, type Fixtures } from './fixtures';

let f: Fixtures;
beforeAll(() => {
  f = fixtures();
});
afterAll(() => f.close());

function tokenOf(result: SignInResult): string {
  if (result.kind !== 'signed_in' && result.kind !== 'mfa_required')
    throw new Error(`expected a token, got ${result.kind}`);
  return result.token;
}

/** Signs in and turns on two-factor, returning the secret for making codes. */
async function enrol(userId: string, email: string): Promise<{ secret: string; token: string }> {
  const token = tokenOf(await signIn(f.db, { email, password: PASSWORD }));
  const { secret } = await beginMfaEnrolment(f.db, userId);
  await confirmMfa(f.db, userId, totpCode(secret, totpStep()));
  return { secret, token };
}

describe('passwords (Argon2id, ASVS L1)', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'wrong password!!')).toBe(false);
    expect(await verifyPassword('not a hash', PASSWORD)).toBe(false);
  });

  it('applies length rules only', () => {
    expect(passwordProblem('short')).toMatch(/at least 12/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/128/);
    expect(passwordProblem('sam@example.test', 'Sam@Example.test')).toMatch(/email/);
    expect(passwordProblem(PASSWORD)).toBeNull();
  });

  it('the database refuses anything but an Argon2id hash', async () => {
    await expect(
      f.admin.query(
        `INSERT INTO core.users (email, display_name, password_hash) VALUES ('x@y.test', 'X', 'plain')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (last six digits).
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 test vectors', () => {
    expect(totpCode(secret, totpStep(59_000))).toBe('287082');
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(secret, totpStep(2_000_000_000_000))).toBe('279037');
  });

  it('accepts one step of clock drift and refuses replays', () => {
    const now = 1_111_111_109_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('seals secrets so they can be opened but not altered', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openSecret(parts.join('.'))).toThrow();
  });
});

describe('sign-in and sessions', () => {
  it('signs in, resolves the session to an actor, and signs out', async () => {
    const site = await f.site();
    const user = await f.user({ roles: ['supervisor'], siteIds: [site] });
    const token = tokenOf(
      await signIn(f.db, { email: user.email.toUpperCase(), password: PASSWORD }),
    );
    const session = await getSession(f.db, token);
    expect(session?.actor.siteIds).toEqual([site]);
    expect(session?.actor.permissions.has('checkouts.edit')).toBe(true);
    expect(session?.actor.permissions.has('users.view')).toBe(false);
    await signOut(f.db, token);
    expect(await getSession(f.db, token)).toBeNull();
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const user = await f.user();
    expect(await signIn(f.db, { email: 'nobody@northkit.test', password: PASSWORD })).toEqual({
      kind: 'invalid',
    });
    expect(await signIn(f.db, { email: user.email, password: 'wrong password here' })).toEqual({
      kind: 'invalid',
    });
  });

  it(`locks the account after ${LOCKOUT_THRESHOLD} failures, even with the right password`, async () => {
    const user = await f.user();
    for (let i = 1; i < LOCKOUT_THRESHOLD; i++)
      expect(
        (await signIn(f.db, { email: user.email, password: 'wrong password here' })).kind,
      ).toBe('invalid');
    expect((await signIn(f.db, { email: user.email, password: 'wrong password here' })).kind).toBe(
      'locked',
    );
    expect((await signIn(f.db, { email: user.email, password: PASSWORD })).kind).toBe('locked');
  });

  it('ends every session when a user is archived', async () => {
    const adminUser = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    const user = await f.user({ roles: ['operative'] });
    const token = tokenOf(await signIn(f.db, { email: user.email, password: PASSWORD }));
    // Signing in updates the user row, so read the version afresh.
    const { rows } = await f.admin.query('SELECT row_version FROM core.users WHERE id = $1', [
      user.id,
    ]);
    await archiveUser(f.db, await f.actor(adminUser.id), user.id, rows[0].row_version);
    expect(await getSession(f.db, token)).toBeNull();
  });

  it('stores only a hash of the session token', async () => {
    const user = await f.user();
    const token = tokenOf(await signIn(f.db, { email: user.email, password: PASSWORD }));
    const { rows } = await f.admin.query(
      'SELECT token_hash FROM core.sessions WHERE user_id = $1',
      [user.id],
    );
    expect(rows[0].token_hash.toString('base64url')).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(32);
  });
});

describe('two-factor sign-in (TOTP)', () => {
  it('asks for a code after the password, then issues a new session', async () => {
    const user = await f.user({ roles: ['operative'] });
    const { secret } = await enrol(user.id, user.email);
    const first = await signIn(f.db, { email: user.email, password: PASSWORD });
    expect(first.kind).toBe('mfa_required');
    const pending = tokenOf(first);
    expect(await getSession(f.db, pending)).toBeNull();
    expect((await completeMfa(f.db, pending, '000000')).kind).toBe('invalid');
    // A fresh step, since enrolment used the current one.
    const done = await completeMfa(f.db, pending, totpCode(secret, totpStep() + 1));
    expect(done.kind).toBe('signed_in');
    expect(tokenOf(done)).not.toBe(pending);
    expect(await getSession(f.db, tokenOf(done))).not.toBeNull();
  });
});

describe('Administrator requires two-factor sign-in (S1-4)', () => {
  it('gives an administrator without two-factor no access until they set it up', async () => {
    const user = await f.user({ roles: ['admin'], allSites: true });
    const token = tokenOf(await signIn(f.db, { email: user.email, password: PASSWORD }));
    const before = await getSession(f.db, token);
    expect(before?.user.mfaSetupRequired).toBe(true);
    expect(before?.actor.permissions.size).toBe(0);
    expect(before?.actor.siteIds).toEqual([]);
    await expect(listSites(f.db, before!.actor)).rejects.toBeInstanceOf(ForbiddenError);

    const { secret } = await beginMfaEnrolment(f.db, user.id);
    await confirmMfa(f.db, user.id, totpCode(secret, totpStep()), { sessionId: before!.sessionId });
    const after = await getSession(f.db, token);
    expect(after?.user.mfaSetupRequired).toBe(false);
    expect(after?.actor.administrator).toBe(true);
    expect(after?.actor.permissions.has('settings.edit')).toBe(true);
  });

  it('won’t let an administrator turn two-factor off', async () => {
    const user = await f.user({ roles: ['admin'], allSites: true });
    const { secret } = await enrol(user.id, user.email);
    expect((await getMfaStatus(f.db, user.id)).required).toBe(true);
    await expect(
      disableMfa(f.db, user.id, PASSWORD, totpCode(secret, totpStep() + 1)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a user without such a role turn it off with password and code', async () => {
    const user = await f.user({ roles: ['operative'] });
    const { secret } = await enrol(user.id, user.email);
    await disableMfa(f.db, user.id, PASSWORD, totpCode(secret, totpStep() + 1));
    expect((await getMfaStatus(f.db, user.id)).enabled).toBe(false);
  });

  it('applies to any role marked requires_mfa, and returns after an admin reset', async () => {
    const roleCode = `mfa_role_${f.tag.toLowerCase()}`;
    await f.admin.query(
      `INSERT INTO core.roles (code, name, permissions, requires_mfa) VALUES ($1, $2, '{overview.view}', true)`,
      [roleCode, `MFA role ${f.tag}`],
    );
    const user = await f.user({ roles: [roleCode], allSites: true });
    await enrol(user.id, user.email);
    const adminUser = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    await resetUserMfa(f.db, await f.actor(adminUser.id), user.id);
    const token = tokenOf(await signIn(f.db, { email: user.email, password: PASSWORD }));
    expect((await getSession(f.db, token))?.user.mfaSetupRequired).toBe(true);
  });
});
