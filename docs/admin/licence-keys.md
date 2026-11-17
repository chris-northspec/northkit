# Licence keys (for NorthSpec, not buyers)

NorthKit licences are signed with NorthKit's own Ed25519 key pair (D8, ADR 0005). **One key pair per product**: never reuse this one for another product, so selling or handing over NorthKit never hands over the key for the others. Only the public key is in the code. The private key is never put in a repo or a synced folder (no OneDrive).

## Make the key pair (once)

1. On a machine you trust, pick a local folder **outside every git repo and every synced folder**, for example `C:\keys-temp`.
2. From the NorthKit repo:

   ```sh
   node scripts/generate-licence-keys.mjs C:\keys-temp
   ```

   It writes `northkit-licence-private.pem` there and prints a line like `'northkit-2026': '<base64>',`. It refuses a folder inside a git working tree or a synced folder, and never overwrites an existing key.

3. Paste the printed line into `NORTHSPEC_PUBLIC_KEYS` in `packages/licence/src/keys.ts`, commit and release. Only versions with this public key accept licences signed by the key.
4. Store the private key:
   - as a **Bitwarden secure note** ("NorthKit licence private key", paste the whole `.pem`), and
   - on the **offline USB copy** (kept somewhere safe, not plugged in).
5. **Delete the `.pem` from disk** (and empty the recycle bin).

## Issue a licence

Sign with the private key from Bitwarden using the studio licence generator (standards repo; never shipped). The file is installed by the customer in Settings, or with `pnpm licence:install --file <path>` on their server.

## If the private key leaks

Anyone with it can forge NorthKit licences. Make a new key pair, replace the public key in `keys.ts` (a new key id), release, and reissue every live licence with the new key. Old releases keep accepting the old key, so tell customers to upgrade.

## Safeguards in the repo

- `packages/licence/test/no-private-keys.test.ts` fails if any key file or private key text is tracked, or would be picked up by `git add`.
- gitleaks scans the full history in CI.
- `.gitignore` and `.dockerignore` exclude `*.pem` and `*.key`.
