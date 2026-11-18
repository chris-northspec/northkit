# NorthKit specification, version 1

Status: **working draft, built from Chris's brief of 17 Nov 2026** (`northkit-setup.md`). Requirement IDs are stable: tests, sprint prompts and the CHANGELOG refer to them. "Sprint" says when each lands (`prompts/roadmap.md`).

## 1. Buyer and problem

**Buyers:** contractors with 10 to 200 staff, plant hire depots, facilities contractors and manufacturers' maintenance teams. They own hundreds or thousands of tools and bits of kit: power tools, access equipment, ladders, lifting gear, generators, test meters.

**Problem:** they need to know **where each item is, who has it, and whether it is safe and in date to use**: LOLER thorough examinations, PUWER inspections, PAT tests, calibration, ladder and harness checks. Today that lives in spreadsheets, paper tags and memory. Kit goes missing, or gets used out of date.

**What NorthKit is:** the owner's register. Every item carries a QR label; it is checked out to a person, van or site in two taps; inspections are scheduled and recorded; defective kit is quarantined so it can't be issued; certificates are kept against the item. It runs on the customer's own server (Route A: NorthSpec never hosts it and the product never contacts NorthSpec).

**What NorthKit is not:** an inspector's tool (Lolerflow and CertFlow serve the examiner, not the kit owner), a brand-tied fleet tool (Hilti, Milwaukee), a hire-out invoicing system, or a GPS tracker. See `docs/research/competitors.md`.

## 2. The boundary (read before writing any wording)

NorthKit **records** inspections and certificates. It **never performs, certifies or signs off** a statutory examination. A thorough examination under LOLER is carried out by a competent person; NorthKit stores their report and the due date. NorthKit can stop an item being issued while it is marked defective, but a person marks the defect and a person records the passed inspection that clears it. Wording everywhere (screens, emails, reports, labels, README, website) says "recorded", "due", "in date", "reported by". It never says NorthKit "certifies", "approves" or "makes compliant". ADR 0003.

## 3. User types

| User | What they do | Default role | Sprint |
| --- | --- | --- | --- |
| Administrator | Owns the install: set-up, people and roles, depots, licence, settings, exports. Two-factor sign-in required. | Administrator | 1 |
| Kit Manager | Runs the register: items, locations, check-outs, inspections, imports, reports; clears quarantined kit after a passed inspection recorded by a person. | Kit Manager | 1 |
| Supervisor | Runs a depot, crew or job: issues and receives kit for the team, records inspections and pre-use checks. | Supervisor | 1 |
| Operative | Phone-first: checks kit out and in and does pre-use checks. Nothing else. | Operative | 1 |
| Viewer | Read-only. | Viewer | 1 |
| Anyone with a phone (no login) | Scans a label: sees only "report a fault". | none | 5 |

Per-depot scoping: each person works at all depots or only the ones listed, and the database refuses to show them any other (DB-06).

## 4. Modules and requirements

### Foundation (Sprint 1)
- **AC-1** Self-hosted sign-in (Argon2id), database sessions, idle timeout warning, lockout after repeated failures.
- **AC-2** Two-factor (TOTP) required for Administrators; any role can require it.
- **AC-3** First-run set-up with a one-time set-up code, single use, no default password anywhere.
- **AC-4** Roles: Administrator, Kit Manager, Supervisor, Operative, Viewer; permission switches by area (overview, locations, items, check-outs, inspections, imports, reports, users, settings) × View, Create, Edit, Approve; roles editable except the locked Administrator.
- **AC-5** Site isolation by row-level security on every site-owned table (DB-06).
- **AC-6** Audit log of admin and record changes (who, when, before, after), filterable, exported as CSV.
- **AC-7** Offline signed licence: 30-day evaluation from set-up, then read-only; never locks reading or export (ADR 0005).
- **ES-1** Depots (sites): code, name, address, time zone, manager. Archived, never deleted.
- **ES-2** Locations per depot: store, van, yard, job site; nested; reference (registration or job number).
- **ST-1** Organisation-wide settings: reminder days, default days out, timeout warning.
- **DE-1** Docker Compose install (db, web, worker), backup and restore scripts, demo-link support.
- **UI-1** The NorthSpec house style app shell; light and dark; WCAG 2.2 AA at 1280 and 390 × 844.

### Items and kinds (Sprint 2)
- **IT-1** Item register with kinds: power tool, lifting gear, access equipment, ladder, harness, PAT item, test instrument, plant. Each kind carries its own inspection rules (a default, editable).
- **IT-2** Per item: serial, make, model, purchase date and cost, owned or hired-in, photos, kind-specific attributes (DB-16), home depot.
- **IT-3** Parent and child items (kit sets): a set is checked out as one, its parts are listed.
- **LB-1** QR labels and printable sheets; a label never carries personal data.
- **LB-2** Scan with a phone camera: signed-in staff open the item; **no-login scan shows only "report a fault"**, with signed codes and rate limits (reusing NorthKeep's design).
- **IM-1** Spreadsheet import with row-by-row checks, all or nothing (reusing ClearRate's importer); a template per kind.

### Where it is (Sprint 3)
- **CO-1** Check out and in to a person, van, site or store in two taps; due-back dates.
- **CO-2** Transfers between depots; who-has-what lists per person, van and depot.
- **CO-3** Overdue returns, with a reminder.
- **CO-4** Missing and lost flow: report missing, find again, or write off (with approval).
- **CO-5** Stocktake by scanning a location: found, not found, found elsewhere.
- **OF-1** Check-out and in and pre-use checks work offline on a phone and sync later (reusing NorthKeep's offline runner); conflicts are kept and shown, never overwritten.

### Safe to use (Sprint 4)
- **IN-1** Inspection schedules by kind: LOLER thorough examination at 6 or 12 months (as the competent person's scheme sets it), PUWER inspections, PAT (risk-based interval), calibration, pre-use checks. All intervals are editable defaults marked "confirm with a competent person".
- **IN-2** Inspection records: result, inspector (a named person, or an external competent person's name and company), date, attached report or certificate (a PDF or a photo).
- **IN-3** **Quarantine.** A defect recorded against an item quarantines it; a quarantined item cannot be checked out until a passed inspection is recorded; enforced in the database (DB-05).
- **IN-4** Reminders at 30, 14 and 3 days before due (setting ST-1), in NorthKit and by the customer's own email; a "due this month" list.
- **IN-5** Pre-use checks: a short checklist at check-out, a fail quarantines.
- **IN-6** Certificates kept against the item, with expiry; an item with an expired certificate shows "out of date" and can be blocked from issue by a setting.

### Dashboard, reports, exports (Sprint 5)
- **DR-1** Dashboard: items out, overdue returns, inspections due and overdue, quarantined, missing; per depot and per person. Every figure opens the list behind it.
- **DR-2** CSV exports of everything; spreadsheet reports for the customer's own use.
- **DR-3** The no-login "report a fault" page (LB-2) lands here with notifications to the Kit Manager.

### Hardening (Sprint 6)
- **X-1** Compliance pack: data map, retention, personal-data export and anonymisation (UK GDPR), security and accessibility review, install and upgrade guides, release audit, tag `v1.0.0-rc1`.

### Out of version 1
GPS and Bluetooth trackers, hire-out invoicing, purchase orders, depreciation. (Chris, 17 Nov 2026.)

## 5. Data held

- **Organisation:** name, country, default time zone, trusted proxy.
- **Depots:** code, name, address, time zone, phone and email (business), manager, notes.
- **Locations:** kind, code, name, reference (a vehicle registration or job number), parent.
- **People:** name, email, phone, password hash, two-factor secret (encrypted), role and depot scope. Personal columns are tagged `[personal]` (DB-13).
- **Items (Sprint 2):** kind, tag, serial, make, model, purchase date, cost, owner or hired-in, photos, attributes, home depot.
- **Movements (Sprint 3):** item, from, to, who, when, due back. Append-only.
- **Inspections (Sprint 4):** item, kind of inspection, due date, result, inspector name, certificate file, defect notes. Append-only; corrections are new rows.
- **No** payment details, no location tracking of people, no photographs of people (photos are of kit, and are stripped of metadata).

## 6. Compliance flags

| Flag | What it means for NorthKit |
| --- | --- |
| LOLER 1998 | Thorough examination by a competent person, 6 months for equipment lifting people and for lifting accessories, 12 months otherwise (or per a written scheme). NorthKit stores the report and the due date. Source: `docs/research/compliance-sources.md`. |
| PUWER 1998 | Work equipment is inspected where its safety depends on installation or conditions; NorthKit schedules and records inspections. |
| PAT | No legal annual requirement; risk-based intervals (IET Code of Practice). NorthKit schedules by an interval the customer sets and records results. |
| Work at Height | Ladder and harness checks recorded; harness thorough examinations per manufacturer. |
| UK GDPR | People data minimal; personal columns tagged; export and anonymisation in Sprint 6. |
| Accessibility | WCAG 2.2 AA; axe clean at 1280 and 390 × 844. |
| Security | OWASP ASVS L1; Argon2id; MFA for Administrators; RLS; rate-limited public endpoints. |

NorthKit is a record-keeping tool. The customer's competent person decides intervals and results.

## 7. User journeys

1. **First day.** An Administrator runs the installer, opens NorthKit, enters the set-up code, names the organisation, creates themselves and the first depot, sets up two-factor, adds locations (a store, vans) and people.
2. **Register the kit.** A Kit Manager imports a spreadsheet of 600 items, prints labels, sticks them on.
3. **Issue kit.** A supervisor scans a drill's label and taps Van 3. Two taps. (Offline in a basement: it syncs later.)
4. **Daily use.** An operative does a pre-use check on a ladder at check-out. It fails (a cracked rung). The ladder is quarantined; it can't be issued to anyone.
5. **Safe to use.** The Kit Manager sees "due this month": 14 harnesses. An external competent person examines them; the Kit Manager records each result and attaches the report; the due dates move.
6. **Lost kit.** A generator is reported missing; a stocktake of Van 2 finds it in the yard.
7. **Audit.** An auditor asks "who had this sling on 3 March and when was it last examined?" The register answers.

## 8. Acceptance tests

Numbered for the QA sheet. "Sprint" is when each first passes.

| # | Test | Sprint |
| --- | --- | --- |
| A1 | A user at depot A sees nothing of depot B: lists, pages by id, search, exports, the audit log. | 1 |
| A2 | An Administrator without two-factor is held at set-up from every page; any role can require it; a reset by an Administrator returns it. | 1 |
| A3 | First-run set-up needs the one-time code, works once, and leaves no default password. | 1 |
| A4 | Sign-in locks after five failures and unlocks after 15 minutes; the same message for an unknown email and a wrong password. | 1 |
| A5 | Switching a role's switch on or off changes what its holders can do at once. | 1 |
| A6 | The audit log records every create, change and delete with who, when, before and after, never a secret, and exports as CSV with the same filters. | 1 |
| A7 | With no licence, NorthKit runs fully for 30 days then goes read-only; read-only never blocks reading, exporting or signing in. | 1 |
| A8 | A clean install from the README steps works on a fresh machine; a backup then restore round trip returns the data. | 1 |
| A9 | The main screens pass axe (WCAG 2.2 AA) at 1280 and 390 × 844 with no sideways scrolling. | 1 onwards |
| A10 | An item is checked out to a person in two taps and checked back in; the history shows who, when and from where. | 3 |
| A11 | A quarantined item **cannot be checked out**, including by a direct database insert as the app role. | 4 |
| A12 | A recorded defect quarantines the item; a passed inspection, recorded by a named person, clears it; nothing else does. | 4 |
| A13 | A LOLER item due in 6 or 12 months shows its due date, reminders arrive at 30, 14 and 3 days, and it appears in "due this month". | 4 |
| A14 | A no-login scan of a label shows only "report a fault" and nothing about the item's owner, location or history; it is rate-limited. | 5 |
| A15 | A spreadsheet import with one bad row imports nothing and says which row and why. | 2 |
| A16 | A check-out made offline syncs later; a clash is kept and shown to both people. | 3 |
| A17 | A stocktake of a location reports found, not found and found elsewhere. | 3 |
| A18 | A transfer between depots moves the item and is visible only to people at the depots involved. | 3 |
| A19 | No screen, email, report or label says NorthKit certifies or approves an examination (a wording test over the app's text). | 2 onwards |
| A20 | Overdue returns appear on the dashboard and in a reminder. | 3 |

## 9. Sprint 2 acceptance tests and where each is tested

New tests added in Sprint 2 are A21 to A27; the ones from section 8 that Sprint 2 touches are mapped too. "unit" is Vitest on a real PostgreSQL 16; "browser" is Playwright at 1280 and 390 × 844 with axe.

| # | Test | Sprint | Where |
| --- | --- | --- | --- |
| A1 | A user at depot A sees nothing of depot B (now including items, photos, history, exports) | 1, 2 | `packages/db/test/site-isolation.test.ts` (items, photos), `packages/core/test/items.test.ts` (services), `packages/core/test/photos.test.ts`, `apps/web/e2e/access.spec.ts` |
| A15 | A spreadsheet import with one bad row imports nothing and says which row and column; 2,000 rows succeed; duplicates are caught in the file and against the register | 2 | `packages/core/test/item-import.test.ts`, `apps/web/e2e/items.spec.ts` (errors, then a clean import) |
| A19 | No screen, email, report or label says NorthKit certifies or approves an examination | 2 | `apps/web/test/wording.test.ts` (scans the app's text), and the notice on every rules screen |
| A21 | Photos: a wrong type is refused, an oversize photo is refused, EXIF and GPS are removed from what is stored, at most 10 per item, another depot's photo is a 404 | 2 | `packages/core/test/media.test.ts`, `packages/core/test/photos.test.ts`, `packages/db/test/register.test.ts` (10 and 10 MB limits), `apps/web/e2e/items.spec.ts` (phone upload) |
| A22 | A label's QR holds an opaque signed token, never the item id; a signed-in scan opens the item; a scan with no login shows only the kind and asset number and "Report a fault: coming soon"; a forged, shortened or replaced code gets the same page; the QR decodes from the printed PDF | 2 | `packages/core/test/labels.test.ts` (decodes the QR from the PDF at all three layouts), `apps/web/e2e/items.spec.ts` |
| A23 | Kinds carry editable inspection rules; only a Kit Manager or Administrator can change them; a kind in use can't be deleted (the database refuses) and a deactivated kind takes no new items | 2 | `packages/core/test/items.test.ts`, `packages/db/test/register.test.ts` |
| A24 | The database refuses what screens must not allow: a status change that isn't permitted, a retired item without a reason, hire details on an owned item, an item in another depot's location, a kit inside a kit, a duplicate asset number | 2 | `packages/db/test/register.test.ts` |
| A25 | The item list searches, filters (kind, depot, status, owned or hired in, kits) and pages; its CSV is formula-safe and holds every match, not one page | 2 | `packages/core/test/items.test.ts`, `apps/web/e2e/items.spec.ts` |
| A26 | `pnpm db:seed-demo` stores the whole fictional company (about 600 items, 15 to 20 kit sets) and running it twice gives the same result | 2 | `packages/core/test/demo-company.test.ts` |
| A27 | Every colour goes through the design tokens: no hard-coded hex or colour function outside `tokens.css`, and text on an accent fill uses `--colour-on-accent` | 2 | `apps/web/test/tokens.test.ts` |
| A9 | The main screens pass axe at 1280 and 390 × 844 with no sideways scrolling (now including items, kinds, import, the item page and the scan page) | 1 onwards | `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/items.spec.ts` |
