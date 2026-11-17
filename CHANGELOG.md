# Changelog

## Unreleased

### Sprint 2: items, kinds, labels, photos, import (branch `sprint-2/items`)
- **Kinds and rules (S2-1):** eight starter kinds with editable inspection rules (type, interval, required, a note) taken from `docs/research/compliance-sources.md`; every screen says they are your own schedule settings, not legal advice. A kind in use can't be deleted (the database refuses); deactivate instead.
- **Item register (S2-2):** items with kind, asset number (typed or generated per kind prefix), serial, make, model, purchase date and exact-pence cost, owned or hired in, home depot and location, status, notes. Kit sets one level deep. Status transitions, kits, hire details and retire reasons are enforced in the database. List with search, filters (kind, depot, status, owned or hired in, kits) and paging; CSV of the filtered list; history from the audit log; retire with a reason.
- **Photos (S2-3):** up to 10 per item, JPEG, PNG or WebP by content, 10 MB each, EXIF and GPS stripped (WebP too), thumbnails by the worker (K22), served only to people with access to the depot.
- **QR labels (S2-4):** opaque AES-GCM label codes (K23), A4 sheets of 21 and 65 and a single 100 × 50 mm label (K24), the QR decoded back from the PDF in tests, replace a label to stop old prints; the scan page: signed in opens the item, no login shows only kind and asset number.
- **Import (S2-5):** CSV and Excel from ClearRate's reader, every problem by row and column, all or nothing, re-checked at store time, kit sets, the worker for large files, audited.
- **Demo seed (S2-6):** `pnpm db:seed-demo` stores about 600 items with 18 kit sets, hired-in and retired items and placeholder photos; running it twice gives the same company.
- **Demo link in Docker (S2-7, K19):** `pnpm demo` and `pnpm demo:docker`, settings in `deploy/.env.demo`; the production guard stays.
- **House style (S2-8):** illustrations drawn with tokens only (K28), the item list and item page checked at both sizes and themes (`docs/screens/`); a test fails on any hard-coded colour outside `tokens.css` and any text on the accent that isn't `--colour-on-accent`; a wording test (A19).
- **Housekeeping:** `graceful-fs` pinned to 4.2.11 as ClearRate does (K25); the files volume is mounted for the worker too and owned by the app user (ClearRate #85); the development files volume is no longer tracked.
- **Counts:** 25 test files, **241 passed**, 7 skipped (Vitest on PostgreSQL 16); Playwright at 1280 and 390 × 844 with axe: **40 passed**, 4 skipped by design; 6 new tables (23 documented).

### Sprint 1: foundation (branch `sprint-1/foundation`)
- **Copied from NorthKeep `main` at `944121d`** (ADR 0002) and stripped of its modules: workspace (`apps/web`, `apps/worker`, `packages/db`, `packages/core`, `packages/licence`), ESLint, Prettier, strict TypeScript, CI, Docker Compose, install, backup and restore scripts, demo-link support.
- Four migrations: foundation, core (organisation, depots, locations, settings, users, roles, sessions), audit, licence and reporting views. Comments on every table and column; the data dictionary is generated.
- Roles Administrator, Kit Manager, Supervisor, Operative, Viewer; nine permission areas; per-depot scoping with row-level security and an isolation test for every site-owned table.
- Audit log with filters and CSV export; settings table with reminder days, default days out and the timeout warning.
- Offline licence module with NorthKit's own (empty) public key list; the demo company generator and `pnpm db:seed-demo`.
- App shell in the NorthSpec house style with an overview. Placeholder accent Kit Teal, mark, icons and sign-in picture.
- The reporting login reads views only.

### Sprint 0: documents and research
- Repo documents, spec, database requirements, ADRs 0001 to 0005, competitor sheet, compliance sources, buyer guide, opportunity report (stand-in score 63/100).
