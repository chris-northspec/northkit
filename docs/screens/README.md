# Screens

## `house-style-check/` (Sprint 2, S2-8)

NorthKit's screens beside NorthSlot's, at **1280** wide and **390 × 844**, in **light and dark**, as the NorthSpec visual standard (section 6) asks. All from made-up data: the demo company (`pnpm db:seed-demo`), plus an empty database for the empty-register screen.

| File (prefix is size and theme, for example `1280-light-`) | What it is |
| --- | --- |
| `…northkit-sign-in` and `…northslot-sign-in` | The sign-in screens side by side. NorthSlot's is its public page |
| `…northkit-item-list` | The item register: filters, chips, the table with status pills and thumbnails (cards on a phone) |
| `…northkit-item-page` | One item: details, photos, kit, label, rules, history. On a phone the item leads, before any panel |
| `…northkit-item-form` | The add-an-item form |
| `…northkit-empty-register` | The empty state with the pack's picture |
| `…northkit-overview` | The overview (Sprint 1) |

**What is not here, and why.** NorthSlot's signed-in screens (day board, list, detail, form) need a NorthSlot login, which the script never asks Claude for. Chris runs it once with his own login, from environment variables only (never printed, and it adds nothing to NorthSlot's database):

```sh
NORTHSLOT_EMAIL=... NORTHSLOT_PASSWORD=... SCREENS_URL=http://localhost:3205 SCREENS_PASSWORD=... \
  node apps/web/scripts/house-style-check.mjs
```

That adds `…northslot-day-board` for each size and theme. **What the pairs show:** the same Ink sidebar, Paper page, page-header pattern (muted context line, large Space Grotesk title, one primary button on the right), card radius, table heads and status pills. The accent is a placeholder (Kit Teal) and the mark is a placeholder: both are replaced from BrandCentre, and every colour already goes through the tokens, so the replacement is one token file.

To retake them: seed the demo database (`NORTHKIT_DB_NAME=northkit_demo_test SEED_DEMO_PASSWORD=... pnpm db:seed-demo`), serve the production build on it (`node apps/web/scripts/serve-standalone.mjs 3205`, with `NORTHKIT_DB_NAME=northkit_demo_test NORTHKIT_COOKIE_SECURE=false`), optionally a second server on an empty database for `SCREENS_EMPTY_URL`, and run the script above with `SCREENS_PASSWORD` set to the demo password.
