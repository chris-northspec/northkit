import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 generated in the app, for the rare case the id must be known before the
 * insert (a new site has to be in the RLS scope of the transaction creating it).
 * Same layout as public.uuid_v7() in the database.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
