# Status and gates

**Stage:** Approved by Chris to build (17 Nov 2026), ahead of validation, as with NorthKeep and ClearRate. Studio-rubric stand-in score **63/100, "needs more evidence"** (`docs/research/opportunity-report.md`), so the optional Gate 1 runs alongside the build. Gate 0 passed 17 Nov 2026. Sprint 0 (research and repo documents) and Sprint 1 (foundation, branch `sprint-1/foundation`) built 17 Nov 2026; Sprint 1 waits for Chris's review.

## Decisions log

Format as NorthKeep's D-numbers. "Proposed (built), Chris to confirm" means it is built and working but Chris has not yet said yes.

| # | Decision | Recommendation | Answer |
| --- | --- | --- | --- |
| K1 | Build the idea | Build ahead of validation | **Approved** (Chris, 17 Nov 2026): product five, banner Construction & Trades (also fits Facilities & Compliance) |
| K2 | Route and stack | Route A, same stack as NorthKeep (ADR 0001) | **Approved** (Chris, 17 Nov 2026) |
| K3 | Name | NorthKit is a working name | **Working name.** UK IPO (classes 9 and 42), Companies House and domain checks before anything public; no website page until Chris confirms |
| K4 | Foundation source | Copy from NorthKeep `main`, record the commit (ADR 0002) | **Done:** `944121d`; NorthKeep's unmerged `sprint-8/release` was not used |
| K5 | The boundary | NorthKit records inspections and certificates; it never performs, certifies or signs off a statutory examination (ADR 0003) | **Approved** (Chris, 17 Nov 2026, in the brief) |
| K6 | Version 1 scope | As the brief: items and kinds, labels, check-out and in, safe to use with quarantine, imports and exports, dashboard and reports, offline; out: GPS and Bluetooth trackers, hire-out invoicing, purchase orders, depreciation | **Approved** (Chris, 17 Nov 2026) |
| K7 | Licence | Per-product Ed25519 key pair, 30-day trial then read-only (ADR 0005). The key list is empty until Chris makes the pair | **Approved** (Chris, 17 Nov 2026, standard 09). **Action for Chris:** make the key pair before the first release candidate |
| K8 | Gate 1 (three buyer conversations, one written commitment) | Optional; Chris may lift it as for ClearRate | **Open.** Not a blocker. Guide: `docs/research/buyer-guide.md` |
| K9 | Accent colour | Kit Teal `#0E7490`, a **placeholder** that avoids Core Blue, Dock Amber, Rate Green and Keep Plum. Mark, wordmark and sign-in picture are also placeholders | **Proposed (built), Chris to confirm.** BrandCentre chooses the real ones |
| K10 | Sign-in tagline | "Know where it is. Know it's safe." (placeholder) | **Proposed (built), Chris to confirm** |
| K11 | Roles and permission areas | Administrator, Kit Manager, Supervisor, Operative (check out and in and pre-use checks only), Viewer; areas overview, locations, items, check-outs, inspections, imports, reports, users, settings × View, Create, Edit, Approve | **Proposed (built), Chris to confirm** |
| K12 | Depots and locations | A "site" is a depot; locations are site (job site), van, store, yard, nestable, with an optional reference (a registration or job number). Depots are managed by people with Settings access | **Proposed (built), Chris to confirm** |
| K13 | Reporting login | `northkit_readonly` reads the `reporting` views only, from the first migration (NorthKeep got there in its Sprint 7) | **Proposed (built), Chris to confirm** |
| K14 | Demo company (S1-10) | Fernbrook Contracting, fictional: 3 depots, each with a store, a cage, a yard and two vans (6 vans), plus 2 job sites, 9 people (one per role) and about 600 generated items. **The items table arrives in Sprint 2**, so `pnpm db:seed-demo` stores the depots, locations and people now and generates and checks the 600 items for Sprint 2 to store | **Proposed (built), Chris to confirm.** A deviation from "~600 items seeded": see the Sprint 1 PR description |
| K15 | Demo link | As NorthKeep built it: development server only. The production build and the Docker web container refuse to start with `NORTHKIT_DEMO_ORIGIN` set, because the tunnel can't be told from the local network inside Docker. `demo-links-prompt.md` asked for dev and Docker | **Proposed (built), Chris to confirm** (same call as NorthKeep) |
| K16 | Ports | Web 3030, database 5450, e2e 3230 to 3233, so NorthKit never collides with the other products' servers on the same PC | **Proposed (built)** |
| K17 | Documents carried over from NorthKeep and dropped | Personal-data export and anonymisation, the full data export, the offline service worker, the monthly report and every NorthKeep module | **Proposed (built).** They return in the sprint that needs them (`prompts/roadmap.md`) |

## Gates

1. **Gate 0, repo and spec: passed** by Chris's approval, 17 Nov 2026.
2. **Gate 1, validation: optional.** Chris may lift it, as he did for ClearRate. At least three buyer conversations with UK contractors or hire firms, and at least one written commitment (a paid pilot, a deposit or a letter of intent) before Sprint 4 (inspections and quarantine). Capture sheet: `docs/research/buyer-guide.md`.
3. **Gate 2, release audit:** before the first release candidate: all tests green, security and accessibility review, the licence key pair made, name checks done, EULA in place, a clean install on a fresh machine.

## Sprints

| Sprint | Scope | Status |
| --- | --- | --- |
| 0 | Repo documents and research (competitors, compliance sources, buyer guide, opportunity report) | Done 17 Nov 2026 |
| 1 | Foundation: workspace, CI, migrations, auth, roles, audit, licence, Docker, app shell, demo company | Built on `sprint-1/foundation`, waiting for review |
| 2 | Items, kinds, labels, QR, photos, import | Not started |
| 3 | Check out and in, transfers, who-has-what, stocktake, offline | Not started |
| 4 | Inspections, quarantine rule, certificates, reminders | Not started |
| 5 | Dashboard, reports, exports, no-login fault reports | Not started |
| 6 | Compliance pack, security and accessibility review, install and upgrade guides, release audit, `v1.0.0-rc1` | Not started |
