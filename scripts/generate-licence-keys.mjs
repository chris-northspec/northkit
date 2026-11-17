// Makes NorthKit's licence-signing key pair (D8, ADR 0005). For NorthSpec, not buyers.
//
//   node scripts/generate-licence-keys.mjs <output folder outside any git repo>
//
// Writes northkit-licence-private.pem (Ed25519, PKCS#8) into that folder, readable by
// you only, and prints the public key as the line packages/licence/src/keys.ts expects.
// It refuses a folder inside any git working tree or a synced folder (OneDrive, Dropbox,
// Google Drive, iCloud), and never overwrites an existing key. One key pair per product:
// never reuse this key for another product. Uses only Node's built-in crypto.
// After running: store the .pem in Bitwarden and on the offline USB copy, then delete it
// from disk (docs/admin/licence-keys.md).
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'northkit-licence-private.pem';
const SYNCED = /(onedrive|dropbox|google ?drive|icloud|nextcloud|box sync)/i;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** True if `dir` (or the nearest folder above it that exists) is inside a git working tree. */
function insideGitWorkTree(dir) {
  let probe = path.resolve(dir);
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    const out = execFileSync('git', ['-C', probe, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false; // not a repo, or git not installed
  }
}

/** Why the folder can't take the private key, or null if it can. */
function refusal(dir) {
  const resolved = path.resolve(dir);
  if (insideGitWorkTree(resolved))
    return `${resolved} is inside a git working tree. The private key must never go in a repo: choose a folder outside every repo.`;
  if (SYNCED.test(resolved))
    return `${resolved} looks like a synced folder. The private key must never go in one: choose a local folder (it goes to Bitwarden and the USB copy afterwards).`;
  if (existsSync(path.join(resolved, FILE_NAME)))
    return `${path.join(resolved, FILE_NAME)} already exists. Nothing was changed: move it away first if you really mean to make a new key.`;
  return null;
}

/** Makes the key pair; returns the raw 32-byte public key, base64. */
function generate(dir) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, FILE_NAME), privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600,
    flag: 'wx',
  });
  return der.subarray(der.length - 32).toString('base64');
}

const dir = process.argv[2];
if (!dir)
  fail('Usage: node scripts/generate-licence-keys.mjs <output folder outside any git repo>');
const problem = refusal(dir);
if (problem) fail(problem);
const publicKey = generate(dir);
const keyId = `northkit-${new Date().getUTCFullYear()}`;
process.stdout.write(
  [
    `Private key written to ${path.join(path.resolve(dir), FILE_NAME)} (readable by you only).`,
    '',
    'Paste this into NORTHSPEC_PUBLIC_KEYS in packages/licence/src/keys.ts:',
    '',
    `  '${keyId}': '${publicKey}',`,
    '',
    'Then: save the .pem as a Bitwarden secure note, copy it to the offline USB stick,',
    'and delete it from this disk. Never put it in a repo or a synced folder.',
    '',
  ].join('\n'),
);
