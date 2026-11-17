# Sprint 2 handover

Branch `sprint-2/items`. Everything in `C:\Northspec\repos\northkit-sprint-2.md` is built and tested locally (S2-0 to S2-9); decisions are K19 to K30 in `docs/01-status-and-gates.md`.

## State at the end of the session
- Unit and database tests: 241 passed, 7 skipped. Playwright (both sizes, axe): 40 passed, 4 skipped. Lint, typecheck, migrate twice, RLS check, data dictionary, build, audit and licence check all exit 0 locally. gitleaks isn't installed locally: CI runs it.
- Verified in Docker: the normal stack builds and runs with the files volume writable by the worker and pdfkit's font data in the web image; the demo profile seeds, serves through its proxy, and recorded the tunnel's visitor address.

## For whoever continues
- Sprint 3 adds check-out and in (schema `movements`), reusing NorthKeep's offline runner (ADR 0004). The status transitions are already in the database (migration 0005).
- Rules of thumb used here: a new site-owned table gets `public.enable_site_isolation`, an entry in `packages/db/test/site-isolation.test.ts`, `audit.track` and comments on every column; a public lookup goes through one owner-run function returning only what a scan may show.
- Open for Chris: K25 (the graceful-fs pin touches the licence rules), K30 (run the NorthSlot half of the house-style check with his own login), and the K-numbers marked "Proposed (built)".
