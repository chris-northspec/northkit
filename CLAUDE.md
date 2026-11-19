# CLAUDE.md — instructions for Claude Code in this repo

You are the lead developer for NorthKit, a self-hosted plant, tool and equipment register for contractors, maintenance firms, plant hire depots and manufacturers: where each item is, who has it, and whether it is safe and in date to use. Chris Ramsden owns NorthSpec and approves every merge.

## Build status
**Approved to build (Chris, 17 Nov 2026), ahead of validation**, as with NorthKeep and ClearRate. Gate 0 passed; decisions K1 onwards are recorded in `docs/01-status-and-gates.md`. Sprint 0 (research, `prompts/sprint-0.md`) and Sprint 1 (foundation, `prompts/sprint-1.md`) come first; Sprints 2 to 6 are in `prompts/roadmap.md`. Gate 1 (buyer conversations) is optional and not a blocker.

## Read first, every session
1. `docs/01-status-and-gates.md` — status, gates, open decisions
2. `docs/02-spec.md` — requirement IDs, user types, modules, acceptance tests (A1 onwards)
3. `docs/03-database-requirements.md` — non-negotiable
4. `docs/decisions/` and `CHANGELOG.md`

## The boundary that shapes every word
**NorthKit records inspections and certificates; it never performs, certifies or signs off a statutory examination.** A thorough examination under LOLER is done by a competent person; NorthKit stores their report and the due date. A quarantine rule stops defective kit being issued, but a person records the defect and a person records the passed inspection that clears it. Screens, emails, reports, labels, the README and the website must say "recorded", "due", "in date" and "reported by", never "certified", "compliant" (as NorthKit's own verdict) or "approved by NorthKit".

## Hard rules
- **Never host or phone home.** No telemetry, no calls to NorthSpec servers. The buyer runs everything.
- **Clean room.** Build from public standards and guidance only (HSE, legislation.gov.uk, public vendor pages). Never use or ask for any employer's code, data, documents, site details, pricing or customer information. Nothing is copied from competitors' screens.
- **Site isolation.** A "site" is a depot or branch. Every site-owned table: `site_id uuid NOT NULL`, RLS enabled and forced, policy on `app.site_ids`, composite FKs on `(site_id, id)`, and an isolation test. The app DB role never has `BYPASSRLS`.
- **Evidence.** Submitted inspections, certificates and check-out movements are never updated in place; corrections are new rows linked to the original. Every change goes to the audit log (who, when, before, after).
- **Quarantine is enforced in the database** (from Sprint 4): a defective item cannot be checked out until a passed inspection is recorded. The app never relies on a screen to enforce it.
- **People decide safety.** No code path lets software certify an item safe, clear a quarantine, or record an inspection result on a person's behalf.
- **Database.** DB-01 to DB-16 (`docs/03-database-requirements.md`): one Postgres schema per module, snake_case plural tables, UUIDv7 ids, standard columns, constraints in the database, `COMMENT` on every table and column, forward-only SQL migrations.
- **Security.** Argon2id passwords, TOTP MFA (required for Administrators), parameterised queries only, secrets from env vars only, no secrets in logs, no passwords, tokens or keys in the repo, docs or chat. OWASP ASVS L1. Public endpoints (the no-login "report a fault" scan page, from Sprint 5) are signed, rate-limited and logged.
- **Dependencies.** MIT, MIT-0, Apache-2.0, BSD, ISC, PostgreSQL, 0BSD or Zlib; the same conditional exceptions as NorthKeep (CC-BY-4.0 data only, MPL-2.0 and BlueOak build tools only, OFL-1.1 font files only). No GPL/AGPL/LGPL in shipped code; MinIO and sharp stay out. Record each in `docs/dependencies.md`.
- **UI.** The NorthSpec visual standard (`C:\Northspec\repos\northspec-visual-standard.md`): hand-written CSS on NorthSpec tokens, NorthSlot is the reference (Ink sidebar on the left, Paper pages, white cards, 4 KPI cards, a wide table beside a "needs action" panel). The product accent is **Hi-Vis Yellow `#F2C200`, a LIGHT accent: text and icons on it are Ink (`--colour-on-accent`), never white**; use Tag Brass (`--accent-text`) for the accent as text, never the yellow itself on Paper or white. The tokens come from BrandCentre `northkit/tokens/accent.css`; every colour goes through them (a test fails on any hard-coded colour). Inter for everything you read; Space Grotesk for page titles, the wordmark and big figures. Status never shown by colour alone (the shared status pill: colour plus word). WCAG 2.2 AA; phone screens usable at 390 × 844 with gloves-friendly 44 px targets. UK spelling, plain words.
- **Units and time.** `timestamptz` UTC; due dates and reminders in the depot's time zone; UK English and UK date formats in the UI.
- **Name.** NorthKit is the product name (UK IPO and Companies House clear, Chris, 17 Nov 2026). The domain northkit.co.uk is not bought yet; the website page waits for Chris.

## Working method
- Branch `sprint-N/<topic>`, small commits with conventional messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Tests alongside code: Vitest (unit + integration on real Postgres), Playwright (desktop 1280 and 390 × 844 phone, with axe).
- Run `pnpm lint && pnpm typecheck && pnpm test` before every commit.
- The foundation was copied from NorthKeep `main` at commit `944121d` (ADR 0002). Reuse later NorthKeep and ClearRate parts (QR labels and no-login reporting, the offline runner, the importer) by copying with a note in the CHANGELOG, never by sharing a database or a runtime.
- Ask Chris before adding any paid service, changing the stack, or anything that would host data outside the buyer's server.
- End each session with: what was done, what's next, any decision needed (K-numbers, "Proposed (built), Chris to confirm"), and a CHANGELOG entry.
