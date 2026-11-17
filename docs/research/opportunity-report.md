# S0-4: Opportunity report, NorthKit

Sprint 0, 17/11/2026. Built from S0-1 to S0-3 in this folder. Every section keeps **Facts** (linked), **Estimates** (our numbers, labelled) and **Assumptions** (what we believe and must test) apart. No market size, price or customer count here is invented: where we have no public figure, the report says so. Idea approved for build by Chris on 17 Nov 2026, ahead of validation.

## 1. Problem

**Facts**
- HSE's own guidance expects owners to know the inspection status of work equipment: PUWER inspection records are kept until the next inspection, hired kit should carry evidence of its last inspection, and lifting equipment needs a thorough examination every 6 or 12 months unless a written scheme says otherwise ([compliance-sources.md](compliance-sources.md)).
- Vendors sell to this need: Tooltagger, EquipReg, Lolerflow, CertFlow, CheckedSafe, itemit and others ([competitors.md](competitors.md)).

**Not found:** any independent UK figure for how much kit goes missing, or for fines and accidents from out-of-date kit. The buyer conversations must supply it. The brief's picture (spreadsheets, paper tags, memory) is Chris's own knowledge and is untested.

## 2. Buyer

**Facts:** none beyond the brief. We read no official count of UK contractors, hire depots or maintenance teams.

**Assumptions:** the reachable buyer owns 300 to 3,000 items across several depots and vans and has no dedicated asset team: a contractor with 10 to 200 staff, a plant and tool hire depot, a facilities contractor, or a manufacturer's maintenance team. The person who feels it is a contracts, depot or health and safety manager.

## 3. Evidence of demand

| Evidence | Strength |
| --- | --- |
| At least a dozen vendors sell tool, plant or inspection registers, several with published prices | Shows a market exists. Says nothing about our buyer, or about self-hosting |
| EquipReg (UK, PUWER and LOLER, owner-facing) is launching | Confirms the idea; also a direct competitor |
| UK buyer conversations | **None yet.** Gate 1 (optional) needs three, with a written commitment before Sprint 4 |

## 4. Competitors and prices

Full table and sources in [competitors.md](competitors.md). Published prices found (17 Nov 2026): **Tooltagger €39 to €119 a month**; **itemit £33 to £249 a month** and Bespoke; **HireHop £46 a month for the first user**; **Lolerflow £250 a month** (for inspectors); **CheckedSafe £1 per asset per week**; **ShareMyToolbox $100 a month**; **Wasp AssetCloud $108 to $375 a month** (cloud or self-hosted). Not published: EquipReg, CertFlow, Asset Panda, Hilti ON!Track. **Seven have a vendor-published price against four that do not.**

## 5. Differentiation

1. **Self-hosted, or a one-off licence.** Among the UK LOLER and PUWER products we read, none offers either. Wasp sells a self-hosted edition, but as a US subscription with no UK statutory features.
2. **The owner's register, any brand.** Lolerflow and CertFlow serve the examiner; Hilti and Milwaukee serve their own fleets.
3. **Quarantine enforced in the database.** A defective item can't be issued. No competitor page we read describes enforcing this at that level.
4. **Honest boundary.** NorthKit records a competent person's decision; it never certifies.
5. **Works offline** on a phone, check-out and pre-use checks.
6. **Priced flat, not per asset.** CheckedSafe's £1 per asset per week is about £2,600 a year for 50 assets and about £26,000 for 500.

**Risk to differentiation:** EquipReg targets the same buyer. Hosted tools are cheap (Tooltagger from €39 a month). The "own server" benefit only matters to buyers who care; we must find out how many do.

## 6. Route

Route A, self-hosted web app (ADR 0001): Next.js, Postgres, Docker Compose, the NorthKeep stack. No change proposed.

## 7. Build estimate

**Estimate:** six sprints to a release candidate: foundation (done in this Sprint 1), items and labels, check-out and offline, inspections and quarantine, dashboard and reports, hardening. Foundations are copied from NorthKeep, QR and offline from NorthKeep, import from ClearRate, which shortens Sprints 2 and 3. **Not estimated in calendar weeks:** several builds run in parallel and elapsed time depends on Chris's review.

## 8. Costs

**Facts:** none of the costs below has a published figure in our sources.
**Assumptions (each needs a quote or Chris's figure before Gate 2):**
- Solicitor-drafted EULA (studio gate): one-off, amount unknown.
- ICO registration (studio gate): annual fee, amount to confirm on ico.org.uk.
- Name checks: UK IPO classes 9 and 42, Companies House, a domain. Not yet done (the name is a working name).
- Code-signing or encoding for the release build: per the studio standard; amount unknown.
- No hosting cost: the buyer runs it.

## 9. Price per tier

**Facts used as anchors:** Tooltagger €59 a month (up to 1,000 tools, about €708 a year); itemit Pro £1,599 a year; Lolerflow £2,700 a year; CheckedSafe £52 per asset a year; HireHop £552 a year for one user.

**Estimate (test prices, not decided):** a renewable annual licence by number of live items, with a one-off option as the differentiator.

| Tier | Live items | Test price a year (ex VAT) | One-off option (about 3 years) |
| --- | --- | --- | --- |
| Small | up to 300 | £700 | £2,000 |
| Standard | up to 1,000 | £1,400 | £4,000 |
| Large | up to 5,000 | £2,400 | £7,000 |
| Unlimited | any | £3,600 | £10,000 |

Test **one** figure per buyer conversation (guide Q19) and record the price the buyer names first. Replace this table with buyer evidence before Sprint 6.

## 10. Channels

**Assumptions** (no channel has been tried):
1. Direct outreach to contracts, depot and health and safety managers on LinkedIn and by email, using the S0-3 message.
2. Trade bodies and events for contractors and hire (for example the Hire Association Europe, the Electrical Contractors' Association): membership or events. Not checked; costs unknown.
3. Inspection firms who examine owners' kit and could recommend a register.
4. Content: plain guides on what HSE does and does not require (the "things we must not claim" list in compliance-sources.md is the editorial line).
5. Not app marketplaces at first: a self-hosted product has no marketplace listing.

## 11. Volume scenarios (all estimates)

These multiply a guessed number of licences by the test prices above. They are not forecasts and carry no market evidence until Gate 1.

| Scenario | Licences sold in year 1 | Mix | Annual licence revenue |
| --- | --- | --- | --- |
| Low | 2 | 2 × Small | £1,400 |
| Middle | 8 | 4 Small, 3 Standard, 1 Large | £9,400 |
| High | 20 | 8 Small, 8 Standard, 3 Large, 1 Unlimited | £27,600 |

**Assumption behind all three:** renewals at the same price; no install or support fees counted; no discounting; one-off sales not counted.

## 12. Compliance flags

- **The boundary** (ADR 0003): NorthKit records, it never certifies. No marketing line may say otherwise.
- **UK GDPR:** small personal data (users, who had what). Export and anonymisation in Sprint 6; ICO registration before release.
- **Advertising claims:** no figures for "lost kit" or "fines avoided". Vendor claims are not ours to repeat.
- **Trade marks:** naming competitors for comparison must be factual and checked; no logos.
- **Clean room:** all research here is public. The brief is Chris's own knowledge; Gate 0 notes it as clean.

## 13. Score

The studio scoring rubric (NorthCore "master prompt §5") is **not in any repo we can read**, as ClearRate found, so this is the same transparent stand-in: ten criteria out of 10. Chris can compare or replace it. Scores are our judgement from the evidence above.

| Criterion | Score | Why |
| --- | --- | --- |
| Problem severity | 7 | Real statutory duties and lost kit, but no independent figures |
| Reachable buyer | 6 | Plausible and varied, uncounted |
| Evidence of demand | 3 | Vendors exist; no UK buyer conversation yet |
| Willingness to pay | 5 | Anchors exist (€59 a month to £2,700 a year); untested |
| Competition and differentiation | 7 | No self-hosted UK option found; EquipReg and cheap hosted tools are real |
| Build effort | 8 | Foundation, QR, offline and import reused |
| Compliance and liability risk | 5 | The boundary is clear but the subject is safety |
| Route fit | 9 | Self-hosted suits the stack and the differentiation |
| Margin and support load | 6 | Customer-run installs, upgrades and backups are theirs |
| Portfolio fit | 7 | Shares the stack; "Construction and Trades" is a new banner |
| **Total** | **63 / 100** | **Needs more evidence** |

Where the gap is: demand and willingness to pay have no UK buyer evidence. That is what the optional Gate 1 supplies.

## 14. Recommendation

**Keep building the foundation (Sprint 1, done), and run the buyer conversations alongside.** Before Sprint 4 (inspections and quarantine), if Gate 1 is not lifted, require three conversations logged, one written commitment and the tiers replaced by buyer evidence. If two of three buyers are happy with a hosted tool or a spreadsheet and do not care where it runs, stop and re-score. Check EquipReg's launch and price first.
