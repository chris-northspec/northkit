# Database requirements (NorthKit)

Same rules as NorthKeep's, adapted for NorthKit: version 1 is about 30 tables (estimate). The isolation key is `site_id`, a depot or branch. These requirements apply from Sprint 1; each is an acceptance check in QA, and the ones marked "tested" already have a test.

| ID | Requirement | Why |
| --- | --- | --- |
| DB-01 | PostgreSQL 16 or later, one database, no second data store. Queue, search and reporting run inside PostgreSQL. (Tested: migrations run on an empty PostgreSQL 16 in every test run.) | One thing to install, back up and secure |
| DB-02 | One PostgreSQL schema per module: `core` (organisation, depots, locations, people, settings, licence), `register` (items, kinds, photos; Sprint 2), `movements` (check-outs and transfers; Sprint 3), `inspections` (schedules, records, certificates; Sprint 4), `audit`, plus `reporting` for views. A schema is added in the migration that first needs it. | Keeps the tables navigable; permissions per module |
| DB-03 | Naming: snake_case, plural tables, `id` primary key (UUIDv7), foreign keys `<thing>_id`, no abbreviations. (Tested.) | Readable without a guide |
| DB-04 | Standard columns: `id`, `site_id` (if site-owned), `created_at`, `created_by`, `updated_at`, `updated_by`, `row_version`. Master data (items, locations, depots, people) archived with `archived_at`, never deleted. Evidence (check-out movements, inspection records, certificates) never updated or deleted, only corrected by a new linked row. | Traceability and safe concurrent edits |
| DB-05 | Rules enforced in the database: foreign keys, `NOT NULL`, unique keys, `CHECK` constraints and triggers. From Sprint 4: **a defective item can't be checked out until a passed inspection is recorded**; a passed inspection can't be recorded by software; an item can't be in two places at once. | Bugs and imports can't create impossible records |
| DB-06 | **Site isolation.** Every site-owned table has `site_id`, forced RLS, a `site_isolation` policy on `app.site_ids` for the app role, an `owner_access` policy for the owner and a SELECT-only `reporting_read` policy; children point at parents through composite `(site_id, id)` keys. `pnpm db:check-rls` fails the build if a table is missing any of it, and every site-owned table has an isolation test (read, insert, update, move and delete across two depots). (Tested.) | A depot never sees another depot's rows, by construction |
| DB-07 | Safe concurrent use: row locks for check-out and in (an item is checked out once), `SKIP LOCKED` where tasks are handed out, `row_version` optimistic locking for office edits. Offline sync replays queued changes with client-generated ids; conflicts become new linked entries, never overwrites. | Many phones at once, some offline |
| DB-08 | Monthly partitions for `audit_events`, and from Sprint 3 and 4 for check-out movements and inspection records. The worker rolls partitions three months ahead each day. (Tested for the audit log.) | Millions of rows over the years |
| DB-09 | Performance proven on a generated fictional data set: 5 depots, 20,000 items, 500,000 movements, 5 years of inspections. Target: phone actions under 300 ms at p95 on a mid-range server (confirmed in Sprint 6). The Sprint 1 demo company (3 depots, 6 vans, about 600 items) is the small set. | Find slow queries first |
| DB-10 | Documented views in `reporting` and a read-only role for Power BI or Excel. `northkit_readonly` reads the views only (no table access), sees every depot through them, and can't write. The app role can't read the views. (Tested.) | Buyer owns their data |
| DB-11 | Versioned, forward-only SQL migrations; expand-then-contract; CI tests upgrades from every released version. A changed migration is refused. (Tested.) | Buyers upgrade themselves |
| DB-12 | Nightly `pg_dump` script (`deploy/backup.sh`), a restore script (`deploy/restore.sh`), restore tested in the clean-install test in CI (backup, change, restore, check). | Backups are the buyer's job; we ship the tools |
| DB-13 | Personal-data columns tagged `[personal]` in their `COMMENT`; retention and export per person arrive with the compliance pack (Sprint 6). (Tagging tested.) | UK GDPR; feeds the compliance pack |
| DB-14 | Every table and column has a `COMMENT`; CI fails if missing; the data dictionary is generated into `docs/data-dictionary/` (`pnpm db:docs`) and CI fails if it is out of date. (Tested.) | Too many tables to document by hand |
| DB-15 | Kysely as the query builder: per-transaction RLS session variables (`set_config`) and raw SQL where clearer. | Isolation first; one query layer across the NorthSpec products |
| DB-16 | Kind-specific attributes (a ladder's rated height, a sling's working load limit) live in one `attributes` JSONB column on items, validated against the item kind's definition and GIN-indexed. No per-customer columns, no key-value tables. | Kind-specific data with no custom code |

## Schema map (estimates)

| Schema | Main tables | Sprint | Tables (est.) |
| --- | --- | --- | --- |
| `core` | organisations, sites (depots), locations (site, van, store, yard), users, roles, user_roles, user_sites, role_sites, sessions, settings, licences | 1 | 11 |
| `register` | items, item_kinds, item_photos, item_sets (kit sets: parent and child), labels | 2 | 6 |
| `movements` | check_outs, transfers, stocktakes, stocktake_lines, loss_reports | 3 | 5 |
| `inspections` | rules by kind, schedules, inspection_records, certificates, quarantines, reminders, pre_use_checks | 4 | 7 |
| `audit` | audit_events (partitioned) | 1 | 1 |
| `reporting` | views for each of the above | 1 onwards | 8 |

Flow: items are registered in `register`; `movements` records where each item is and who has it; `inspections` records whether it is safe and in date, and quarantines it when it is not; check-out refuses a quarantined item.

## NorthKit notes
- DB-05: the quarantine rule is a trigger on `movements.check_outs`, not a check in the app. A test proves a quarantined item cannot be checked out even by a direct SQL insert as the app role.
- DB-07: an item belongs to one location at a time; moving it is a new movement row, the current location is derived or maintained by trigger, never typed.
- DB-12: the files volume (photos and certificate files, from Sprint 2) is archived with the dump.
