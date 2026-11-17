import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// D8: no private key is ever committed. gitleaks checks history in CI; this catches it
// locally, before a commit: every tracked file, and every new file git would pick up
// (untracked but not ignored), is checked by name and by content.

const repo = path.join(import.meta.dirname, '..', '..', '..');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);

const files = [
  ...new Set([...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')]),
];

// Built in pieces so this file doesn't match itself.
const BEGIN = '-----BEGIN';
const PRIVATE_KEY = new RegExp(`${BEGIN} ((RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----`);
const KEY_FILE = /\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)$|licence-private/i;
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|zip)$/i;

describe('no private keys in the repo (D8)', () => {
  it('has no key files', () => {
    expect(files.filter((f) => KEY_FILE.test(f))).toEqual([]);
  });

  it('has no private key in any file', () => {
    const found = files.filter((f) => {
      if (BINARY.test(f)) return false;
      const full = path.join(repo, f);
      try {
        if (statSync(full).size > 2_000_000) return false;
        return PRIVATE_KEY.test(readFileSync(full, 'utf8'));
      } catch {
        return false; // deleted in the working tree
      }
    });
    expect(found).toEqual([]);
  });

  it('lists only public keys, 32 bytes each, in keys.ts', () => {
    const keys = readFileSync(path.join(repo, 'packages', 'licence', 'src', 'keys.ts'), 'utf8');
    expect(keys).not.toMatch(PRIVATE_KEY);
    for (const [, value] of keys.matchAll(/'[^']+':\s*'([A-Za-z0-9+/=]+)'/g))
      expect(Buffer.from(value!, 'base64')).toHaveLength(32);
  });
});
