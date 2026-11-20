# Dependencies

Every direct dependency, its licence and why it is here. Copied from NorthKeep main (commit `944121d`, ADR 0002) and trimmed to what NorthKit uses today. Allowed: MIT, MIT-0, Apache-2.0, BSD-2/3-Clause, ISC, PostgreSQL, 0BSD, Zlib (CLAUDE.md), plus the same conditional licences as NorthKeep and NorthCore WMS (below). `pnpm licences:check` checks every installed package, direct and indirect, in CI. Anything else must be listed in [`scripts/licence-exceptions.json`](../scripts/licence-exceptions.json) with a reason and Chris's approval (currently empty). Credits ship with the product in [`LICENCES/CREDITS.md`](../LICENCES/CREDITS.md).

Fonts, icons and images: the mark, app icons (rounded and maskable), favicon and apple-touch icon in `apps/web/public/` are made from the BrandCentre mark (`northkit/logo`); the sign-in picture and the other illustrations are original SVG drawn inline in the design tokens (`components/illustration.tsx`). **Inter** is self-hosted from `@fontsource/inter` (SIL OFL 1.1, font files only): served from the customer's server, never fetched from a font service. **Space Grotesk** is self-hosted from `@fontsource/space-grotesk` (SIL OFL 1.1, font files only) for page titles, the wordmark and big figures, as in NorthSlot; Inter is used for everything else you read.

## Shipped with the product (runtime)

| Package | Version | Licence | Used by | Why |
| --- | --- | --- | --- | --- |
| next | 16.4 | MIT | web | App Router web framework (ADR 0001) |
| react, react-dom | 19.3 | MIT | web | UI library for Next.js |
| server-only | 0.0.1 | MIT | web | Build error if server code (database, sessions) is imported into the browser bundle |
| @fontsource/space-grotesk | 5.3.0 | OFL-1.1 (font files only) | web | Space Grotesk for titles, the wordmark and big figures (weights 500, 600), self-hosted |
| @fontsource/inter | 5.3.0 | OFL-1.1 (font files only) | web | Inter typeface for every product screen, self-hosted (weights 400, 500, 600) |
| zod | 4.6 | MIT | web, core | Input validation |
| kysely | 0.29 | MIT | db | Typed SQL builder; per-transaction `set_config` for RLS (DB-15) |
| pg | 8.23 | MIT | db | PostgreSQL driver |
| @node-rs/argon2 | 2.2 | MIT | core | Argon2id password hashing (prebuilt native binary, no build step) |
| pg-boss | 12.38 | MIT | worker | Job queue inside PostgreSQL (DB-01); OpenTelemetry switched off |
| qrcode-generator | 2.0 | MIT | core | Draws QR codes on the server (two-factor set-up now; item and location labels from Sprint 2). No dependencies; nothing leaves the server |
| pdfkit | 0.20.2 | MIT | core (web, worker) | Draws the QR label PDFs (S2-4): A4 sheets and single labels, with PDFKit's built-in Helvetica (no font file shipped). Pulls in fontkit, linebreak, png-js, fflate, @noble/hashes and @noble/ciphers, brotli, pako, restructure, dfa, tiny-inflate, unicode-properties, unicode-trie, clone, base64-js (all MIT). Server side only; nothing is fetched |
| jpeg-js | 0.4.4 | BSD-3-Clause | core | Decodes and encodes JPEGs for item-photo thumbnails (S2-3), in pure JavaScript. Also used by ClearRate |
| pngjs | 7.0.0 | MIT | core | Decodes PNGs for thumbnails and writes the demo's placeholder photos. Also used by ClearRate |
| read-excel-file | 9.3.17 | MIT | core | Reads .xlsx imports (S2-5): each cell's stored value, never calculating a formula, never running a macro; numbers read as exact text. Brings fflate, saxen, worker-f, unzipper-esm (all MIT) and graceful-fs (pinned, below). As ClearRate |
| write-excel-file | 4.1.1 | MIT | core | Writes the Excel import template. As ClearRate |
| lucide-react | 1.69.0 | ISC | web | The icon set (House style v2, standard 13, K32): one stroke width, sizes 16, 20 and 24, always beside text where meaning matters. Tree-shaken, so only the icons used ship |
| jsqr | 1.4.0 | Apache-2.0 | web | Reads a QR label from the phone camera in the browser where it has no BarcodeDetector (S3-2). The frame never leaves the phone. Also used in the label tests |
| webp-wasm | 1.0.6 | MIT (its WebAssembly is libwebp from Squoosh, Apache-2.0) | core (worker) | Decodes WebP item photos for thumbnails in the worker (K22, Chris 19 Nov 2026). No native binary; loaded on first use |
| tsx | 4.23 | MIT | worker, migrate | Runs the worker and the migration and CLI tools from TypeScript source in the `tools` Docker image |

The licence module (`packages/licence`) uses only Node's built-in `crypto` (Ed25519): no licensing library.

Added in Sprint 3: lucide-react, jsqr (now in the app too) and webp-wasm (above). Added in Sprint 2: pdfkit, jpeg-js, pngjs, read-excel-file and write-excel-file (above). Not carried over from NorthKeep yet, and added back with the sprint that needs it: nodemailer (MIT-0, email reminders, Sprint 4) and the spreadsheet report writers (Sprint 5).

## Development and CI only (not shipped)

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| typescript | 6.0 | Apache-2.0 | Type checking (held below 6.1 until typescript-eslint supports TypeScript 7, as NorthKeep) |
| @types/node, @types/pg, @types/react, @types/react-dom | | MIT | Type definitions |
| eslint, @eslint/js | 10 | MIT | Linting |
| typescript-eslint | 8.72 | MIT | TypeScript lint rules (type-aware) |
| @next/eslint-plugin-next | 16.4 | MIT | Next.js lint rules |
| eslint-config-prettier | 10.1 | MIT | Turns off lint rules Prettier handles |
| globals | 17 | MIT | Global variable lists for ESLint |
| prettier | 3.10 | MIT | Formatting |
| vitest | 5.1 | MIT | Unit and integration tests on real PostgreSQL |
| @playwright/test | 1.65 | Apache-2.0 | Browser tests at 1280 wide and 390 × 844 |
| @axe-core/playwright, axe-core | 4.11 | MPL-2.0 (build and test tools only, unmodified) | WCAG 2.2 AA checks in the browser tests. Allowed by the MPL-2.0 condition: never shipped, never modified |
| jsqr (also shipped, above) | 1.4 | Apache-2.0 | Independent QR decoder in the tests to prove the QR codes we draw read back correctly, including from the printed label PDFs |
| pdfjs-dist | 6.5 | Apache-2.0 | Independent PDF reader in the label tests: reads back each page's text, so what a PDF viewer shows is checked, not what our code meant to write |
| @types/pdfkit, @types/pngjs | | MIT | Type definitions |

## Pinned, with the reason

| Package | Pin | Why |
| --- | --- | --- |
| graceful-fs | 4.2.11 (ISC), via `overrides` in `pnpm-workspace.yaml` | 4.2.12 and later moved to BlueOak-1.0.0, which our rules allow for build tools only, and it ships here (read-excel-file → unzipper-esm). 4.2.11 is the same code under ISC. The same pin as ClearRate (its C17, agreed by Chris 15 Nov 2026): recheck on every upgrade of read-excel-file; `pnpm licences:check` fails if a newer graceful-fs slips in. **K25: Chris to approve for NorthKit** |

## Not installed on purpose

| Package | Why |
| --- | --- |
| sharp | Optional Next.js dependency; its libvips binary is LGPL-3.0. Excluded via `ignoredOptionalDependencies` in `pnpm-workspace.yaml`; image optimisation is off. |
| MinIO | AGPL. Files go on a Docker volume or the customer's own S3-compatible bucket. |
| Tailwind CSS, component libraries | Hand-written CSS on NorthSpec tokens (CLAUDE.md, ADR 0001). |
| A licensing library | Ed25519 in Node's `crypto` does it in a few lines, offline. |

## Licences allowed with conditions

Approved by Chris on 13 Nov 2026 (OFL-1.1 on 14 Nov 2026) for NorthCore WMS and applied to every NorthSpec product. `scripts/check-licences.mjs` enforces each condition; none of these is GPL, AGPL or LGPL.

| Licence | Condition | How the check enforces it |
| --- | --- | --- |
| CC-BY-4.0 | Data only, with credit | Each package must be credited by name in `LICENCES/CREDITS.md`, which ships in the web image |
| MPL-2.0 | Build tools only, not modified | Fails if the package is shipped (production dependency) or patched |
| BlueOak-1.0.0 | Build tools only | Fails if the package is shipped |
| OFL-1.1 | Font files only, never code; with credit; not modified | Fails unless the package holds only font files, their stylesheets and metadata, is credited, and isn't patched |

| Package | Licence | Shipped? | Pulled in by |
| --- | --- | --- | --- |
| caniuse-lite | CC-BY-4.0 | Yes (data, dependency of next) | next → browserslist |
| lightningcss (+ platform binaries) | MPL-2.0 | No (build-time CSS compiler) | next |
| @axe-core/playwright, axe-core | MPL-2.0 | No (browser tests) | apps/web devDependencies |
| minimatch, @isaacs/nonrecursive-glob-match | BlueOak-1.0.0 | No | eslint, typescript-eslint |

## Known advisories

| Package | Severity | Path | Status |
| --- | --- | --- | --- |
| minimatch < 11.0.1 | Moderate (GHSA-g3hv-75wg-m249, denial of service on crafted globs) | typescript-eslint → minimatch | Development only; not shipped. CI fails on high or critical only. Clears when typescript-eslint updates its dependency. |
| picomatch <= 4.0.7 | High (GHSA-fc5q-39xc-vjpf, ReDoS) | eslint tooling: @next/eslint-plugin-next → fast-glob → micromatch; typescript-eslint → tinyglobby | Dev tooling only, not shipped, no patched version. **Allow-listed** in `pnpm-workspace.yaml` (K18), only this ID. **Review by 17 Dec 2026.** |
