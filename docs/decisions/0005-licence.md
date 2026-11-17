# 0005 — Licence: a per-product key pair, 30-day trial, then read-only

**Date:** 17 Nov 2026 · **Status:** Accepted (Chris, 17 Nov 2026, in the set-up brief; standard 09)

## Decision
- **Offline signed licence file**: JSON `{ format, keyId, payload, signature }`, Ed25519, verified with Node's built-in `crypto` against public keys in `packages/licence/src/keys.ts`. No library, no network. Copied from NorthKeep.
- **A key pair per product.** NorthKit has its own, never shared, so selling or handing over one product never hands over the key for the others. **The list in `keys.ts` is empty (a placeholder)** until Chris makes the pair with `scripts/generate-licence-keys.mjs` (`docs/admin/licence-keys.md`). The private key never goes in a repo or a synced folder.
- **No licence installed:** 30 days' full use from first set-up, then read-only.
- **States:** evaluation, valid, expiring (60, 30, 7 days), grace (30 days after expiry, fully working), then lapsed, unlicensed or invalid, which are **read-only**: every scoped transaction runs `READ ONLY`, so PostgreSQL itself refuses writes. Reading, exporting, signing in, two-factor and installing a licence always work. Nothing is ever deleted or locked.
- **Depot limit:** an optional `maxSites` in the licence is checked when a depot is added.

## Consequences
- Until the key exists no licence verifies and every install runs the evaluation, then read-only. Chris must make the key pair before the first release candidate.
- A licence problem can never brick a depot mid-shift or lose data.
