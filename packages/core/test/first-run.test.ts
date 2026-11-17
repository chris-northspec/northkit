import { createDb, createPool, type Db } from '@northkit/db';
import { createFreshDatabase, dropTestDatabase } from '@northkit/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSession, signIn } from '../src/auth/sessions';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import {
  completeFirstRun,
  isFirstRun,
  SETUP_ATTEMPT_LIMIT,
  setupCodeMatches,
} from '../src/services/first-run';

// S1-7: a fresh install forces set-up with a one-time code; there is no default
// password. Runs on its own empty database, since set-up only works with no users.

const NAME = 'northkit_first_run_test';
const CODE = 'ABCD-EFGH-JKMN';
let db: Db;

const input = (setupCode: string) => ({
  setupCode,
  organisation: { name: 'Example Logistics Ltd' },
  admin: {
    displayName: 'First Admin',
    email: 'First@Example.test',
    password: 'a long first password',
  },
  site: { code: 'dav1', name: 'Daventry DC' },
});

beforeAll(async () => {
  await createFreshDatabase(NAME);
  db = createDb(createPool('app', { database: NAME, max: 2 }));
});
afterAll(async () => {
  await db.destroy();
  await dropTestDatabase(NAME);
});

describe('first-run set-up (S1-7)', () => {
  it('starts with no users and no default password', async () => {
    expect(await isFirstRun(db)).toBe(true);
    const { count } = await db
      .selectFrom('core.users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(0);
    expect(await signIn(db, { email: 'admin@example.test', password: 'admin' })).toEqual({
      kind: 'invalid',
    });
  });

  it('is locked when the server has no set-up code', async () => {
    await expect(
      completeFirstRun(db, input(CODE), {}, { expectedCode: '' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a wrong code and audits it', async () => {
    await expect(
      completeFirstRun(db, input('WRNG-CODE-0000'), {}, { expectedCode: CODE }),
    ).rejects.toBeInstanceOf(ValidationError);
    const { count } = await db
      .selectFrom('audit.audit_events')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('action', '=', 'auth.setup_code_failed')
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(1);
  });

  it('ignores case, spaces and hyphens in the code', () => {
    expect(setupCodeMatches('abcd efgh jkmn', CODE)).toBe(true);
    expect(setupCodeMatches('ABCDEFGHJKMN', CODE)).toBe(true);
    expect(setupCodeMatches('ABCDEFGHJKMX', CODE)).toBe(false);
    expect(setupCodeMatches('', '')).toBe(false);
  });

  it('creates the organisation, first site and administrator, who must set up two-factor first', async () => {
    const { token } = await completeFirstRun(
      db,
      input(CODE),
      { ipAddress: '192.0.2.1' },
      { expectedCode: CODE },
    );
    expect(await isFirstRun(db)).toBe(false);
    const session = await getSession(db, token);
    expect(session?.user).toMatchObject({
      email: 'first@example.test',
      mfaSetupRequired: true,
      mustChangePassword: false,
    });
    expect(session?.actor.permissions.size).toBe(0);
    const org = await db.selectFrom('core.organisations').select('name').executeTakeFirstOrThrow();
    expect(org.name).toBe('Example Logistics Ltd');
    expect(session?.licence.state).toBe('evaluation');
  });

  it('works once only: the code is useless afterwards', async () => {
    await expect(
      completeFirstRun(db, input(CODE), {}, { expectedCode: CODE }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it(`pauses after ${SETUP_ATTEMPT_LIMIT} wrong codes in the window`, async () => {
    const fresh = 'northkit_first_run_limit_test';
    await createFreshDatabase(fresh);
    const other = createDb(createPool('app', { database: fresh, max: 1 }));
    try {
      for (let i = 0; i < SETUP_ATTEMPT_LIMIT; i++)
        await expect(
          completeFirstRun(other, input('NOPE'), {}, { expectedCode: CODE }),
        ).rejects.toThrow(/isn’t right/);
      await expect(
        completeFirstRun(other, input(CODE), {}, { expectedCode: CODE }),
      ).rejects.toThrow(/Too many wrong/);
    } finally {
      await other.destroy();
      await dropTestDatabase(fresh);
    }
  });
});
