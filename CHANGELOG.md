# Changelog

## Unreleased

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
