import { spawnSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LICENCE_FORMAT, readLicence } from '../src/licence';
import { payload } from './sign';

// D8: scripts/generate-licence-keys.mjs. Run as Chris would run it, into a temporary
// folder; the throwaway key made here is deleted afterwards and never committed.

const repo = path.join(import.meta.dirname, '..', '..', '..');
const script = path.join(repo, 'scripts', 'generate-licence-keys.mjs');
const temp = mkdtempSync(path.join(tmpdir(), 'nk-keys-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const run = (dir: string) =>
  spawnSync(process.execPath, [script, dir], { encoding: 'utf8', cwd: repo });

describe('licence key generator (D8)', () => {
  it('refuses a folder inside a git working tree', () => {
    const result = run(path.join(repo, 'packages', 'not-here'));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/inside a git working tree/);
  });

  it('refuses a synced folder', () => {
    const result = run(path.join(temp, 'OneDrive', 'keys'));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/synced folder/);
  });

  it('writes the private key outside the repo and prints a public key that verifies its signatures', () => {
    const dir = path.join(temp, 'out');
    const result = run(dir);
    expect(result.status, result.stderr).toBe(0);
    const line = /'(northkit-\d{4})': '([A-Za-z0-9+/=]{44})',/.exec(result.stdout);
    expect(line).not.toBeNull();
    const [, keyId, publicKey] = line!;
    const pemPath = path.join(dir, 'northkit-licence-private.pem');
    if (process.platform !== 'win32') expect(statSync(pemPath).mode & 0o777).toBe(0o600);

    // Sign a licence with the new private key; the printed public key accepts it.
    const bytes = Buffer.from(JSON.stringify(payload()));
    const file = JSON.stringify({
      format: LICENCE_FORMAT,
      keyId,
      payload: bytes.toString('base64url'),
      signature: sign(null, bytes, createPrivateKey(readFileSync(pemPath))).toString('base64url'),
    });
    expect(readLicence(file, { [keyId!]: publicKey! })).toMatchObject({ ok: true });
  });

  it('never overwrites an existing key', () => {
    const result = run(path.join(temp, 'out'));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/already exists/);
  });
});
