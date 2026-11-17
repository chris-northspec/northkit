import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '@northkit/db';
import { createFreshDatabase, dropTestDatabase } from '@northkit/db/migrate';
import { verifyPassword } from '../src/auth/password';
import { clientAddress, isLoopback } from '../src/net/client-address';
import { demoDatabaseOk, demoRefusal, demoWarning } from '../src/net/demo';

// The demo link (docs/demo-link.md): a Cloudflare Tunnel on Chris's PC connects from
// loopback and names the visitor in Cf-Connecting-Ip; the shared demo Administrator.

const run = promisify(execFile);

describe('the tunnel’s visitor address', () => {
  const tunnel = { trustLoopback: true };

  it('is believed from loopback when the demo link is on', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      expect(
        clientAddress(
          { peer, forwardedFor: '198.51.100.9', connectingIp: '203.0.113.7' },
          [],
          tunnel,
        ),
      ).toBe('203.0.113.7');
    // No Cf-Connecting-Ip: the forwarded address from the tunnel.
    expect(clientAddress({ peer: '127.0.0.1', forwardedFor: '203.0.113.8' }, [], tunnel)).toBe(
      '203.0.113.8',
    );
  });

  it('is ignored from any other address, and from loopback when the demo link is off', () => {
    const forged = { forwardedFor: '198.51.100.9', connectingIp: '203.0.113.7' };
    expect(clientAddress({ peer: '192.0.2.44', ...forged }, [], tunnel)).toBe('192.0.2.44');
    expect(clientAddress({ peer: '172.18.0.1', ...forged }, [], tunnel)).toBe('172.18.0.1');
    expect(clientAddress({ peer: '127.0.0.1', ...forged }, [])).toBe('127.0.0.1');
    // A named customer proxy still never makes Cf-Connecting-Ip count.
    expect(clientAddress({ peer: '10.0.0.5', ...forged }, ['10.0.0.5'], tunnel)).toBe(
      '198.51.100.9',
    );
    // Rubbish in the header: fall back to what is known.
    expect(
      clientAddress(
        { peer: '127.0.0.1', forwardedFor: null, connectingIp: 'nonsense' },
        [],
        tunnel,
      ),
    ).toBe('127.0.0.1');
  });

  it('knows loopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.4.5.6')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('::2')).toBe(false);
  });
});

describe('the demo link outside the development server', () => {
  const ORIGIN = 'https://northkit-demo.test';
  const preload = path.join(import.meta.dirname, '../../../apps/web/server/peer-address.mjs');

  it('stops any server other than the development one', () => {
    for (const nodeEnv of ['production', 'test', undefined])
      expect(demoRefusal(ORIGIN, nodeEnv)).toContain('NorthKit will not start');
    expect(demoRefusal(ORIGIN, 'development')).toBeNull();
    expect(demoRefusal(undefined, 'production')).toBeNull();
  });

  it('names the trusted addresses in the development server’s warning', () => {
    expect(demoWarning(ORIGIN)).toContain('from 127.0.0.1 and ::1 (this machine)');
    expect(demoWarning(undefined)).toBeNull();
  });

  it('is refused by the Docker image’s preload before the server loads', async () => {
    const start = (env: Record<string, string>) =>
      run(process.execPath, ['--import', pathToFileURL(preload).href, '-e', 'console.log("up")'], {
        env: { ...process.env, ...env },
      });
    await expect(
      start({ NODE_ENV: 'production', NORTHKIT_DEMO_ORIGIN: ORIGIN }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('NorthKit will not start'),
    });
    expect((await start({ NODE_ENV: 'production', NORTHKIT_DEMO_ORIGIN: '' })).stdout.trim()).toBe(
      'up',
    );
    expect(
      (await start({ NODE_ENV: 'development', NORTHKIT_DEMO_ORIGIN: ORIGIN })).stdout.trim(),
    ).toBe('up');
  });
});

describe('pnpm demo:user', () => {
  const DEMO_DB = 'northkit_dev_demo_user_test';
  const PASSWORD = 'tunnel ferry lantern 42';
  const cli = (env: Record<string, string>) =>
    run(
      process.execPath,
      [
        path.join(import.meta.dirname, '../../../node_modules/tsx/dist/cli.mjs'),
        path.join(import.meta.dirname, '../src/cli/demo-user.ts'),
      ],
      { env: { ...process.env, ...env } },
    );

  beforeAll(async () => {
    await createFreshDatabase(DEMO_DB);
  });
  afterAll(async () => {
    await dropTestDatabase(DEMO_DB);
  });

  it('refuses a database that isn’t a demo or development one, and a short password', async () => {
    await expect(
      cli({ NORTHKIT_DB_NAME: 'northkit_test', DEMO_SHARED_PASSWORD: PASSWORD }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('never a customer') });
    await expect(
      cli({ NORTHKIT_DB_NAME: DEMO_DB, DEMO_SHARED_PASSWORD: 'short' }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('at least 12 characters') });
  });

  it('makes the Administrator, changes its password when run again, and never prints it', async () => {
    const first = await cli({ NORTHKIT_DB_NAME: DEMO_DB, DEMO_SHARED_PASSWORD: PASSWORD });
    expect(first.stdout).toContain('made the Administrator demo@northspec.test');
    expect(first.stdout + first.stderr).not.toContain(PASSWORD);
    const second = await cli({ NORTHKIT_DB_NAME: DEMO_DB, DEMO_SHARED_PASSWORD: `${PASSWORD}!` });
    expect(second.stdout).toContain('updated');
    const pool = createPool('admin', { database: DEMO_DB, max: 1 });
    try {
      const { rows } = await pool.query<{ password_hash: string; roles: string[]; mfa: boolean }>(
        `SELECT u.password_hash, array_agg(r.code) AS roles, u.mfa_secret_encrypted IS NOT NULL AS mfa
           FROM core.users u JOIN core.user_roles ur ON ur.user_id = u.id JOIN core.roles r ON r.id = ur.role_id
          WHERE u.email = 'demo@northspec.test' GROUP BY u.id`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.roles).toEqual(['admin']);
      expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(rows[0]!.password_hash, `${PASSWORD}!`)).toBe(true);
      expect(await verifyPassword(rows[0]!.password_hash, PASSWORD)).toBe(false);
      // No bypass: two-factor is still to be set up, as the Administrator role requires.
      expect(rows[0]!.mfa).toBe(false);
    } finally {
      await pool.end();
    }
  });
});

describe('the Docker demo profile (K19)', () => {
  const origin = 'https://northkit-demo.example';

  it('is the only production-mode server allowed to run with a demo origin, and only on a demo database', () => {
    const was = { flag: process.env.NORTHKIT_DEMO_SIDECAR, db: process.env.NORTHKIT_DB_NAME };
    try {
      // A normal production server still refuses.
      delete process.env.NORTHKIT_DEMO_SIDECAR;
      process.env.NORTHKIT_DB_NAME = 'northkit_demo_test';
      expect(demoRefusal(origin, 'production')).toMatch(/will not start/);
      // The sidecar flag with a demo database is allowed.
      process.env.NORTHKIT_DEMO_SIDECAR = '1';
      expect(demoRefusal(origin, 'production')).toBeNull();
      // The flag with a customer's database name is not: it still refuses.
      process.env.NORTHKIT_DB_NAME = 'northkit';
      expect(demoRefusal(origin, 'production')).toMatch(/will not start/);
      // The flag alone, on any other value, is not the sidecar.
      process.env.NORTHKIT_DB_NAME = 'northkit_demo_test';
      process.env.NORTHKIT_DEMO_SIDECAR = 'yes';
      expect(demoRefusal(origin, 'production')).toMatch(/will not start/);
    } finally {
      if (was.flag === undefined) delete process.env.NORTHKIT_DEMO_SIDECAR;
      else process.env.NORTHKIT_DEMO_SIDECAR = was.flag;
      if (was.db === undefined) delete process.env.NORTHKIT_DB_NAME;
      else process.env.NORTHKIT_DB_NAME = was.db;
    }
  });

  it('accepts only demo and development database names', () => {
    for (const ok of ['northkit_demo_test', 'northkit_dev', 'northkit_my_demo'])
      expect(demoDatabaseOk(ok), ok).toBe(true);
    for (const bad of ['northkit', 'northkit_prod', 'demo', '', undefined, 'northkit_demo; drop'])
      expect(demoDatabaseOk(bad), String(bad)).toBe(false);
  });

  it('keeps trusting only loopback: a visit from Docker’s gateway is never believed', () => {
    const tunnel = { trustLoopback: true };
    const forged = { forwardedFor: '198.51.100.9', connectingIp: '203.0.113.7' };
    expect(clientAddress({ peer: '172.18.0.1', ...forged }, [], tunnel)).toBe('172.18.0.1');
    expect(clientAddress({ peer: '127.0.0.1', ...forged }, [], tunnel)).toBe('203.0.113.7');
  });
});
