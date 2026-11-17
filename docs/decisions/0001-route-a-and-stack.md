# 0001 — Route A and the NorthKeep stack

**Date:** 17 Nov 2026 · **Status:** Accepted (Chris, 17 Nov 2026, in the set-up brief)

## Context
NorthKit is product five. The tool and equipment register could be sold as a hosted service, like every competitor found in `docs/research/competitors.md`, or installed by the customer. No UK LOLER or PUWER product we found offers self-hosting or a one-off licence.

## Decision
**Route A: self-hosted.** The customer installs it on their own server or cloud account; NorthSpec never hosts it, never sees the data and the product never contacts NorthSpec. The stack, standards, security and testing are the same as NorthKeep, NorthCore WMS, NorthSlot and ClearRate: Node.js 22, strict TypeScript, a pnpm workspace (`apps/web`, `apps/worker`, `packages/db`, `packages/core`, `packages/licence`), Next.js App Router as a PWA, hand-written CSS on NorthSpec tokens, PostgreSQL 16 with RLS and `ltree`, plain SQL migrations, Kysely, Zod, self-hosted auth (Argon2id, database sessions, TOTP), pg-boss, files on a Docker volume, the customer's own SMTP, Docker Compose.

## Consequences
- Foundation code is copied from NorthKeep (ADR 0002); skills, tests and release checks carry over.
- No Vercel or Supabase accounts; nothing for NorthSpec to run.
- A customer-run install is the selling point against hosted competitors, and the cost: upgrades and backups are the customer's job, so we ship the scripts (DB-11, DB-12).
