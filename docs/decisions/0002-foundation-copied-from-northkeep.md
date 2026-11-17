# 0002 — Foundation copied from NorthKeep main

**Date:** 17 Nov 2026 · **Status:** Accepted (Chris, 17 Nov 2026, in the set-up brief)

## Context
ClearRate copied its foundation from NorthKeep. NorthKit does the same: sign-in, roles, depots, audit, licence, deploy and the app shell are the same problems.

## Decision
The foundation was copied from **NorthKeep `main` at commit `944121d` (`944121d0d11e7a68b51365205777d4545bb031f1`)**, taken with `git archive` from the `main` branch so NorthKeep's unmerged work on `sprint-8/release` was not included. NorthKeep's modules (issues, jobs, inspections, assets, planned maintenance, compliance, contractors, documents, notifications, reports, import, the public report form, the offline runner) were **removed**, not hidden. The 21 migrations were replaced by four NorthKit migrations: foundation, core, audit, licence and reporting. Names were changed (`northkeep` to `northkit`, ports 3030 and 5450). Artwork was not copied: the mark, icons and sign-in picture are original placeholders.

Changes from the copy, deliberately: roles are Administrator, Kit Manager, Supervisor, Operative and Viewer; permission areas are overview, locations, items, check-outs, inspections, imports, reports, users, settings; locations are site, van, store and yard (no buildings, floors, business hours or holidays); a `core.settings` table; the reporting login reads views only, from the first migration (NorthKeep reached that in its sprint 7).

## Consequences
- Later parts (QR labels and no-login reporting, the offline runner, the importer from ClearRate, email) are copied in the sprint that needs them, each noted in the CHANGELOG.
- Fixes found in NorthKeep after `944121d` must be ported by hand.
