# Sprint 3 handover (branch `sprint-3/movements`, 19 to 20 Nov 2026)

Kept current through the session, as the prompt asks. The PR description is `C:\Northspec\repos\northkit-sprint-3-PR-description.md`.

## Done

- **S3-0 Chris's answers:** K31 approved and K30 left for Chris (recorded in `docs/01-status-and-gates.md`); **K22 WebP thumbnails built** (webp-wasm in the worker, a test that a WebP upload gets a thumbnail, and that one the worker can't decode is marked as having none); the **`demo-link.spec.ts` flake** traced to `networkidle` waits (the development server's hot-reload connection keeps the network busy, so the wait times out or returns early and a click lands on a form React hasn't taken over): every wait is now on a hydration marker the app sets (`components/hydrated.tsx`), and the proof is three clean full runs in a row (66 passed, 6 skipped by design, each time), plus one more after the last cosmetic fixes.
- **S3-1 Visual v2:** tokens (warm neutrals, surface levels 0 to 3, the accent ramp from one line, radius 6/10/14/20/pill, shadow 1 to 3, motion, a data-viz palette) in `tokens.css`, the signature (eyebrow with tick, accent spine on one hero card, dashed footers) and components in `styles/v2.css` and `components/ui/`; the shell with Lucide icons and a collapsing sidebar; the overview's four stat cards from real movement history with a sparkline, delta chips in words and footer links, beside a needs-action panel with severity edges and the all-clear picture; v2 tables (sticky header, identity column with a kind icon chip, initials, tabular figures, pills, hover and kebab actions, density toggle, cards on a phone) on items, kinds, the overview and who has what; skeleton loading and designed empty and error states; sign-in and the scan page as hero cards. The contrast test covers every new pair in light and dark; the token test fails on any hard-coded radius or shadow.
- **S3-2 to S3-5:** migration `0006_movements` (append-only movements partitioned by month, transfers, stocktakes, the whereabouts guard, `in_transit`, the owner-run movement trigger); services for check-out, check-in, bulk, missing and found, who has what, My kit, transfers and stocktakes; the phone flows at 56 px targets with one step per screen, a big tick and a shake on error; a camera scanner (BarcodeDetector where the browser has it, jsQR otherwise).
- **S3-6 Offline:** the phone's copy of the kit, the queue with client ids, one `/api/sync` endpoint, the service worker for the phone screens, the banner with a count and the "Changes not sent yet" page; a clash is refused, kept and shown.
- **S3-7:** three months of demo history; screens retaken.

## Counts

Vitest: 28 files, 340 passed, 13 skipped. Playwright: 66 passed, 6 skipped by design, three clean full runs in a row. Offline suite: 20 of 20. Licence check clean (234 packages, 82 in production); RLS, comments and the data dictionary clean. gitleaks is not installed on this machine, so that step ran in CI only.

## Decisions

K32 to K38, all "Proposed (built), Chris to confirm", in `docs/01-status-and-gates.md`.

## Not yet met (follow-ups)

- Email reminders for overdue returns: Sprint 4, with the inspection reminders (the moment an item becomes overdue is stored in `overdue_at`).
- The kebab row menu is a `<details>` element: it works with a keyboard and a screen reader, but has no arrow-key roving yet.
- Progress rings and "by type" mini bar charts (standard 13, charts) have no figure to show until Sprint 4's inspections; the sparkline is the one chart.
- Pre-use checks join the offline queue in Sprint 4.
