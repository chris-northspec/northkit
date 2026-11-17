# NorthKit roadmap

Sprint 0 (research) and Sprint 1 (foundation) are in sprint-0.md and sprint-1.md. Each later sprint gets its own prompt when it starts.

## Sprints 2 to 6
2. Items, kinds, labels, QR, photos, import; **also: finish the demo seed (store the ~600 generated items from `packages/core/src/dev/demo-company.ts`), and add demo-link support under Docker as well as dev** (Chris, 17 Nov 2026) · 3. Check out/in, transfers, who-has-what, stocktake, offline · 4. Inspections, quarantine rule, certificates, reminders · 5. Dashboard, reports, exports, no-login fault reports · 6. Compliance pack, security and accessibility review, install/upgrade guides, release audit, tag `v1.0.0-rc1`.


## Version 1 scope (for `docs/02-spec.md` and the roadmap)
- **Items and kinds:** item register with kinds (power tool, lifting gear, access equipment, ladder, harness, PAT item, test instrument, plant) carrying their own inspection rules; serial, make, model, purchase date and cost, owner/hired-in flag; photos; parent/child (kit sets).
- **Labels:** QR labels and printable sheets; scan with a phone camera; no-login scan shows only "report a fault" (reuse NorthKeep's signed QR + no-login reporting with rate limits).
- **Where it is:** check out/in to a person, van, site or store; transfers between sites; due-back dates; who has what; missing/lost flow; stocktake by scanning a location.
- **Safe to use:** inspection schedules by kind (LOLER 6/12 months, PUWER, PAT, calibration, pre-use checks); records with result, inspector, date, attached report/certificate; **defects quarantine the item: it can't be checked out until a passed inspection is recorded** (database-enforced); reminders at 30/14/3 days; "due this month" list.
- **Imports and exports:** spreadsheet import with row-by-row checks, all or nothing (reuse ClearRate's importer); CSV exports of everything.
- **Dashboard and reports:** items out, overdue returns, inspections due/overdue, quarantined, missing; per site and per person.
- **Offline:** pre-use checks and check-out/in work offline on a phone and sync later (reuse NorthKeep's offline runner).
- **Out of v1:** GPS/Bluetooth trackers, hire-out invoicing, purchase orders, depreciation.

