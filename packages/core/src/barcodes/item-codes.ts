import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from 'node:crypto';
import { optionalEnv, requireEnv } from '@northkit/db';

// The code in an item's QR label (S2-4, LB-1, LB-2). It is a short opaque token, never the
// item's id in plain form: the id and the label version are encrypted and authenticated
// with AES-256-GCM under a key derived from NORTHKIT_SECRET_KEY. The same item and
// version always give the same token (the nonce is derived from them), so a reprinted
// label is identical, and a forged or edited token fails the tag and is treated exactly
// like one that never existed. Replacing a label adds one to the item's label version, so
// every older print stops working. Changing NORTHKIT_SECRET_KEY retires every label
// (as it does two-factor secrets): reprint them.

const CODE = /^[A-Za-z0-9_-]{62}$/;

function keys(): { enc: Buffer; iv: Buffer } {
  const secret = Buffer.from(requireEnv('NORTHKIT_SECRET_KEY'), 'base64');
  return {
    enc: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'northkit-item-label-v1', 32)),
    iv: Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'northkit-item-label-iv-v1', 32)),
  };
}

function body(itemId: string, version: number): Buffer {
  const out = Buffer.alloc(18);
  Buffer.from(itemId.replace(/-/g, ''), 'hex').copy(out, 0);
  out.writeUInt16BE(version, 16);
  return out;
}

/** The token printed in a label's QR code. */
export function signItemCode(itemId: string, version: number): string {
  const { enc, iv } = keys();
  const plain = body(itemId, version);
  const nonce = createHmac('sha256', iv).update(plain).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', enc, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64url');
}

/** The item and label version a token names, or null if it was changed or isn't a label code. */
export function verifyItemCode(code: string): { itemId: string; version: number } | null {
  if (!CODE.test(code)) return null;
  const raw = Buffer.from(code, 'base64url');
  if (raw.length !== 12 + 18 + 16) return null;
  try {
    const { enc } = keys();
    const decipher = createDecipheriv('aes-256-gcm', enc, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(30));
    const plain = Buffer.concat([decipher.update(raw.subarray(12, 30)), decipher.final()]);
    const hex = plain.subarray(0, 16).toString('hex');
    return {
      itemId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      version: plain.readUInt16BE(16),
    };
  } catch {
    return null;
  }
}

/** Where labels point: NORTHKIT_PUBLIC_URL, or the address the request came in on. */
export function publicBaseUrl(fallback?: string): string {
  return (optionalEnv('NORTHKIT_PUBLIC_URL') ?? fallback ?? 'http://localhost:3030').replace(
    /\/+$/,
    '',
  );
}

export function itemLabelUrl(code: string, base?: string): string {
  return `${publicBaseUrl(base)}/i/${code}`;
}
