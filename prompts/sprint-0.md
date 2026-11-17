# NorthKit Sprint 0: repo docs and research

Part A of the original set-up brief (17 Nov 2026), kept here for the record. No product code.

## The product in one paragraph
Contractors, maintenance firms, plant hire depots and manufacturers own hundreds or thousands of tools and bits of kit: power tools, access equipment, ladders, lifting gear, generators, test meters. They need to know **where each item is, who has it, and whether it's safe and in date to use**: LOLER thorough examinations, PUWER inspections, PAT tests, calibration, ladder and harness checks. Today that lives in spreadsheets, paper tags and memory, and kit goes missing or gets used out of date. NorthKit is the register: every item labelled with a QR code, checked out to a person, van or site in two taps, inspections scheduled and recorded, defective kit quarantined so it can't be issued, and certificates kept against the item. It runs on the customer's own server.

**Important boundary:** NorthKit records inspections and certificates; it never performs, certifies or signs off a statutory examination. Thorough examinations under LOLER are done by a competent person; NorthKit stores their report and due date. Wording everywhere must reflect this.

## What the market looks like (Head of Dev research, 17 Nov 2026; re-check and date every price in S0-1)
| Product | What it is | Published price | Hosting |
| --- | --- | --- | --- |
| [Tooltagger](https://www.softwareadvice.co.uk/software/529244/Tooltagger) | Tool register + inspection scheduling | €39 / €59 / €79 a month (250 / 1,000 / 10,000 tools), extra users €15–25 | Cloud (EU) |
| [ShareMyToolbox](https://g2.com/products/sharemytoolbox/pricing) | Tool tracking, check-in/out | Listed as $100 per user per month and as $65 base + $10/user (G2, conflicting) | Vendor-hosted |
| [EquipReg](https://www.capterra.co.uk/software/1111217/EquipReg) | PUWER/LOLER plant register, PAT, calibration | "Starting £1,200" (unit not stated) | Cloud |
| [Lolerflow](https://www.capterra.com/p/10040832/Lolerflow/) | LOLER thorough-examination reports for inspectors | £250 a month flat | Cloud |
| [CertFlow](https://www.capterra.com/p/10043256/CertFlow/) | UK inspection firm platform (LOLER, PUWER, fire, PSSR) | £30 / £40 / £45 a month | Cloud |
| Hilti ON!Track, Milwaukee ONE-KEY, Asset Panda, Itemit ([ABAX list](https://www.abax.com/en-gb/blog/10-best-tool-asset-tracking-software)) | Tool/asset tracking | Quote-based | Cloud |

**Gap (to test in research):** none found offers self-hosting or a one-off licence; brand-tied tools (Hilti, Milwaukee) suit single-brand fleets; inspection-firm tools (Lolerflow, CertFlow) serve the examiner, not the kit owner. NorthKit = the **owner's** register, any brand, on their own server.

## Part A — repo docs and Sprint 0 (no product code)

### A1. Repo documents (mirror NorthKeep's layout and tone)
`CLAUDE.md`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE.md` (proprietary placeholder), `LICENCES/`, `.gitignore`, `.gitattributes`, `.editorconfig`, PR template, and:
- `docs/01-status-and-gates.md`: Gate 0 (repo + spec, passed by Chris's approval 17 Nov), Gate 1 (three buyer conversations with UK contractors/hire firms, at least one written commitment; **optional, Chris may lift it as he did for ClearRate**), Gate 2 (release audit). Decisions log K1 onwards.
- `docs/02-spec.md`: buyer, problem, user types, modules, data held, compliance flags, user journeys, acceptance tests (numbered A1…). Use the v1 scope below.
- `docs/03-database-requirements.md`: same rules as NorthKeep's (PostgreSQL 16+, constraints in the database, RLS per organisation and site, comments on every table and column, data dictionary generated, forward-only migrations, backup and restore).
- `docs/decisions/` ADRs: 0001 Route A and stack (same as NorthKeep), 0002 foundation copied from NorthKeep main (record the commit hash), 0003 inspections are records not certification, 0004 offline phone use, 0005 licence (per-product key pair, 30-day trial then read-only, standard 09).
- `prompts/sprint-0.md`, `prompts/sprint-1.md` (this file's Part A and B), `prompts/roadmap.md` (Sprints 2–6 below).

### A2. Sprint 0 research (public sources only; feeds the opportunity report)
| ID | Task | Acceptance |
| --- | --- | --- |
| S0-1 | Competitor sheet: the products above plus at least two more (e.g. Itemit, Asset Panda, a UK plant-hire system); re-check every price on the vendor's own page | `docs/research/competitors.md`, every price linked and dated, hosting model noted |
| S0-2 | Regulation sources: LOLER 1998 (thorough examination intervals 6/12 months, reports, defects), PUWER 1998 (inspection), PAT (IET Code of Practice, risk-based intervals), Work at Height (ladders, harnesses), calibration practice. HSE pages and official guidance only | `docs/research/compliance-sources.md`: links and our own summary, no copied text |
| S0-3 | Buyer guide and capture sheet (reuse ClearRate's `docs/research/buyer-interview-guide.md` format): contractors 10–200 staff, hire depots, facilities contractors, manufacturers' maintenance teams | `docs/research/buyer-guide.md` |
| S0-4 | Opportunity report and studio score out of 100 (facts, estimates, assumptions separated; price per tier; channels; build estimate) | `docs/research/opportunity-report.md` |


## Rules (same as every NorthSpec product)
- Clean-room: public sources only; no employer code, data, customers or confidential knowledge; nothing copied from competitors' screens.
- No telemetry to us. Secrets only in env files. No passwords, tokens or keys in the repo, docs or chat.
- OWASP ASVS L1, WCAG 2.2 AA, UK spelling, plain words.
- Name check (UK IPO classes 9 and 42, Companies House, domain) before anything public; the website page waits until Chris confirms the name.
