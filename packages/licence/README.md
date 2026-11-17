# packages/licence

Offline licence check (S1-7, studio standard 09). Copied from NorthKeep main (944121d); NorthKit has its own key list, which is empty until Chris makes the key pair (ADR 0005).

- A licence is a JSON file: `{ format, keyId, payload, signature }`. `payload` is base64url JSON (product, reference, licensee, issue and expiry dates, major versions covered, site limit, grace days); `signature` is Ed25519 over the payload bytes.
- The product verifies it against the public keys in `src/keys.ts`. Nothing is sent anywhere.
- States: `evaluation` (no licence, first 30 days), `valid`, `expiring` (60, 30, 7-day warnings), `grace` (30 days past expiry, still fully working), then `lapsed`, `unlicensed` or `invalid`, which are **read-only**: every scoped database transaction runs `READ ONLY`, so PostgreSQL itself refuses writes. Data stays visible and exportable; sign-in, two-factor and installing a licence still work. Nothing is ever deleted or locked.
- A renewal is a new file installed in Settings (or `pnpm licence:install <file>`); no reinstall.

The signing side is not here: the private key and the generator live outside this repo. Tests sign with throwaway keys (`test/sign.ts`).
