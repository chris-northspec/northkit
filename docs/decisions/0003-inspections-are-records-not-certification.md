# 0003 — Inspections are records, not certification

**Date:** 17 Nov 2026 · **Status:** Accepted (Chris, 17 Nov 2026, in the set-up brief)

## Context
Thorough examinations under LOLER are carried out by a competent person. HSE sets who may do them, the intervals (6 or 12 months, or a written scheme) and what a report must say (`docs/research/compliance-sources.md`). A kit register that appeared to certify, approve or pass an item would mislead its users and could expose NorthSpec.

## Decision
NorthKit **stores** a competent person's report and the due date and **reminds** the customer. It never performs, certifies or signs off a statutory examination.
- Every result is recorded by a named person (or an external examiner's name and company) with a date; software never records one.
- **Quarantine** stops a defective item being issued: a person records the defect, the database refuses check-out, and only a passed inspection recorded by a person clears it. The rule is enforced in the database (DB-05), not a screen.
- Pre-use checks, detailed inspections and thorough examinations are kept distinct, as HSE keeps them.
- Intervals are editable defaults marked "confirm with a competent person". NorthKit never states an interval as "the legal interval" without the written-scheme alternative, and never states an HSE interval where HSE gives none (harnesses, ladders, calibration, PAT).
- Wording everywhere says "recorded", "due", "in date", "reported by"; never "certified", "approved by NorthKit" or "compliant" as NorthKit's verdict. A test over the app's text enforces it (acceptance A19).
- Standard line: "NorthKit stores your records and reminds you when they are due. You remain responsible for having examinations done by a competent person."

## Consequences
- Some customers will want NorthKit to "say it's compliant". It won't.
- The compliance pack (Sprint 6) states the boundary in the customer's own paperwork.
