# NorthKit Sprint 1: foundation

Part B of the original set-up brief (17 Nov 2026), kept here for the record. Branch sprint-1/foundation. Copied from NorthKeep main (commit 944121d, ADR 0002).

## Part B — Sprint 1: foundation (branch `sprint-1/foundation`)
Copy the foundation from **NorthKeep `main`** (record the hash), stripping NorthKeep-specific modules. Same as ClearRate did from NorthKeep.

| ID | Task | Acceptance |
| --- | --- | --- |
| S1-1 | pnpm workspace (`apps/web` Next.js + TypeScript, `apps/worker` pg-boss, `packages/db` Kysely + plain SQL migrations, `packages/core`, `packages/licence`), ESLint, Prettier, strict TS | lint + typecheck clean |
| S1-2 | CI (GitHub Actions): lint, typecheck, unit/db tests, Playwright, gitleaks CLI, dependency audit, licence allow-list check (MIT, Apache-2.0, BSD, ISC, MIT-0; SIL OFL font files only) | CI green on the PR |
| S1-3 | Migrations: organisations, sites, locations (site, van, store, yard), users, roles, audit log, settings; comments on every table/column; data dictionary generated | `pnpm db:migrate` from empty; dictionary in `docs/data-dictionary/` |
| S1-4 | Auth: self-hosted sign-in, Argon2id, MFA required for Administrators, sessions, timeout warning, first-run set-up code | tests for sign-in, MFA, lockout, set-up code single use |
| S1-5 | Roles: Administrator, Kit Manager, Supervisor, Operative (check out/in and pre-use checks only), Viewer; per-site scoping; site isolation tested on every site-owned table (RLS) | isolation test per table |
| S1-6 | Audit log of admin and record changes; export CSV | test |
| S1-7 | Licence module copied (offline signed key, 30-day evaluation then read-only, never locks out reading or export) with NorthKit's own public key placeholder | tests |
| S1-8 | Docker Compose (db, web, worker), `deploy/install.sh`, backup and restore scripts, `.env.example`; demo-link support (`DEMO_ORIGIN`, trusted loopback proxy, `pnpm demo:user` for `demo@northspec.test` from `DEMO_SHARED_PASSWORD`) as in `C:\Northspec\repos\demo-links-prompt.md` | clean install from README on a fresh VM passes; backup → restore round trip |
| S1-9 | App shell in the NorthSpec visual standard (`C:\Northspec\repos\northspec-visual-standard.md`, NorthSlot is the reference): dark sidebar, KPI cards, table + needs-action panel; Space Grotesk names/titles, Inter UI, self-hosted; light and dark; NorthKit accent token from BrandCentre once chosen (placeholder until then, must not clash with Core Blue, Dock Amber, Rate Green or Keep Plum) | axe clean at 1280 and 390 × 844 |
| S1-10 | Fictional demo company (a contractor with 3 depots, 6 vans, ~600 items) seeded; never real names | `pnpm db:seed-demo` |

**Done means:** all tests pass (unit/db + Playwright at 1280 and 390 × 844 with axe), CI green, gitleaks clean, licence check clean, clean install passes, PR description written to `C:\Northspec\repos\northkit-sprint-1-PR-description.md`. Report: what was built, test counts, anything decided (K-numbers, "Proposed (built), Chris to confirm").


## Version 1 scope (for `docs/02-spec.md` and the roadmap)
- **Items and kinds:** item register with kinds (power tool, lifting gear, access equipment, ladder, harness, PAT item, test instrument, plant) carrying their own inspection rules; serial, make, model, purchase date and cost, owner/hired-in flag; photos; parent/child (kit sets).
- **Labels:** QR labels and printable sheets; scan with a phone camera; no-login scan shows only "report a fault" (reuse NorthKeep's signed QR + no-login reporting with rate limits).
- **Where it is:** check out/in to a person, van, site or store; transfers between sites; due-back dates; who has what; missing/lost flow; stocktake by scanning a location.
- **Safe to use:** inspection schedules by kind (LOLER 6/12 months, PUWER, PAT, calibration, pre-use checks); records with result, inspector, date, attached report/certificate; **defects quarantine the item: it can't be checked out until a passed inspection is recorded** (database-enforced); reminders at 30/14/3 days; "due this month" list.
- **Imports and exports:** spreadsheet import with row-by-row checks, all or nothing (reuse ClearRate's importer); CSV exports of everything.
- **Dashboard and reports:** items out, overdue returns, inspections due/overdue, quarantined, missing; per site and per person.
- **Offline:** pre-use checks and check-out/in work offline on a phone and sync later (reuse NorthKeep's offline runner).
- **Out of v1:** GPS/Bluetooth trackers, hire-out invoicing, purchase orders, depreciation.

## Rules (same as every NorthSpec product)
- Clean-room: public sources only; no employer code, data, customers or confidential knowledge; nothing copied from competitors' screens.
- No telemetry to us. Secrets only in env files. No passwords, tokens or keys in the repo, docs or chat.
- OWASP ASVS L1, WCAG 2.2 AA, UK spelling, plain words.
- Name check (UK IPO classes 9 and 42, Companies House, domain) before anything public; the website page waits until Chris confirms the name.
