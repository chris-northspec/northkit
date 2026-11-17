# 0004 — Offline phone use

**Date:** 17 Nov 2026 · **Status:** Accepted for Sprint 3 (Chris, 17 Nov 2026, in the version 1 scope); not built in Sprint 1

## Context
Kit is checked out in basements, plant yards and rural job sites with no signal.

## Decision
Pre-use checks and check-out and in work **offline** on a phone and sync later, reusing NorthKeep's offline runner: a service worker keeps the app and the pages the person has opened, and an IndexedDB queue holds unsynced changes, replayed with client-generated ids.
- Nothing queued is dropped silently: each answer tells the phone to retry or to show the refusal.
- **Conflicts are kept, not overwritten**: if two people checked out the same item offline, both movements are kept and shown to both, and the Kit Manager resolves it (DB-07, acceptance A16).
- The queue is cleared on sign-out, and kept pages are forgotten.
- While the licence is read-only, the queue is held until it is renewed.

## Consequences
- Sprint 1 ships only the plumbing it inherits: the JSON sync helper `apps/web/src/lib/server/api.ts`, the licence read-only status code and the sign-out message. The service worker, queue and runner arrive in Sprint 3 with their tests.
