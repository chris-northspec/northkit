import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireEnv } from '@northkit/db';

// AES-256-GCM for secrets stored in the database (TOTP seeds). Format:
// v1.<iv>.<tag>.<ciphertext>, each part base64url.
function key(): Buffer {
  const raw = Buffer.from(requireEnv('NORTHKIT_SECRET_KEY'), 'base64');
  if (raw.length !== 32) throw new Error('NORTHKIT_SECRET_KEY must be 32 bytes, base64-encoded.');
  return raw;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function openSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unrecognised sealed secret.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
