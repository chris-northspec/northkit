// NorthKit's licence-signing public keys, by key id: raw 32-byte Ed25519 keys, base64.
//
// One key pair per product (D8, ADR 0005): this list holds NorthKit's key only, never
// another product's, so selling or handing over one product never hands over the key
// for the others. Only PUBLIC keys belong here. The private key never goes in a repo or
// a synced folder: it lives in Bitwarden (secure note) plus one offline USB copy.
//
// Chris makes the key pair with `node scripts/generate-licence-keys.mjs <folder outside
// the repo>` (docs/admin/licence-keys.md) and pastes the printed line here. Until then
// no licence file can verify, so every install runs the 30-day evaluation, then goes
// read-only.
export const NORTHSPEC_PUBLIC_KEYS: Readonly<Record<string, string>> = {};
