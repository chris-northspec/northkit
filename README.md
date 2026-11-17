# NorthKit

**Know where it is. Know it's safe.** (working tagline) A self-hosted register of plant, tools and equipment for contractors, maintenance firms, plant hire depots and manufacturers: every item labelled with a QR code, checked out to a person, van or site in two taps, inspections scheduled and recorded, defective kit quarantined so it can't be issued, and certificates kept against the item.

A NorthSpec product (working name; banner Construction & Trades). Route A: the customer installs it on their own server; NorthSpec never hosts it, never sees the data, and the product never contacts NorthSpec.

**What NorthKit is not:** it records inspections and certificates. It never performs, certifies or signs off a statutory examination: a thorough examination under LOLER is done by a competent person, and NorthKit stores their report and the due date. You remain responsible for having examinations done by a competent person.

## Status

**In development.** Built so far: the foundation (Sprint 1): sign-in with two-factor for Administrators, roles and per-depot access, depots and locations (stores, vans, yards, job sites), the audit log, settings, the offline licence, the Docker install, and the app shell with an overview. **Not built yet:** items, labels, check-out and in, inspections and quarantine, reports (Sprints 2 to 6, `prompts/roadmap.md`). See `docs/01-status-and-gates.md` and `CHANGELOG.md`.

## Install on a server (Docker)

You need a Linux server (or a Windows or Mac machine for a trial) with Docker Engine 24 or later and Docker Compose v2, and about 2 GB of free memory.

1. Copy this folder to the server, for example to `/opt/northkit`, and go there.
2. Make the settings file with fresh passwords, keys and a one-time set-up code:

   ```sh
   sh deploy/install.sh
   ```

   It writes `deploy/.env` (readable by you only) and prints the **set-up code once**. Note it down. There is no default password anywhere.

3. Start NorthKit:

   ```sh
   docker compose -f deploy/docker-compose.yml up -d --build --wait
   ```

   The first start builds the images and takes a few minutes. `migrate` sets up the database and exits; `web`, `worker` and `db` keep running.

4. Open `http://<server>:3030` in a browser. You are sent to **Set up**: enter the set-up code, your organisation, yourself as the first administrator and your first depot. You then set up two-factor sign-in on your phone (an authenticator app), which administrators must use.
5. Put NorthKit behind your own HTTPS reverse proxy before anyone else uses it. Session cookies are sent over HTTPS only (`NORTHKIT_COOKIE_SECURE=true`, the default). Then, in **Settings → Reverse proxy**, name the proxy's address (for example `10.0.0.5`), so rate limits count each client's own address rather than the proxy's. Until you do, the forwarded address is ignored, because any client can send one.
6. In **Settings**, install the licence file NorthSpec sent you. Until then NorthKit runs fully for a 30-day evaluation, then goes read-only.

Lost the set-up code before using it? `sh deploy/install.sh --new-setup-code`, then `docker compose -f deploy/docker-compose.yml up -d web`. Locked out of every administrator account? `docker compose -f deploy/docker-compose.yml run --rm migrate pnpm admin:create --email you@example.com --name "Your Name"`.

On Windows with Docker Desktop, if `up --build` stops with *additional privileges requested: --allow=fs.read*, run it with `BUILDX_BAKE_ENTITLEMENTS_FS=0` set (a Docker Compose build check, not a NorthKit setting).

Set `NORTHKIT_PUBLIC_URL` in `deploy/.env` to the address people use (for example `https://kit.example.co.uk`): labels, QR codes and email links will point there from Sprint 2.

### Roles

| Role | What it is for |
| --- | --- |
| Administrator | Everything, including settings, roles, the licence and exports. Two-factor sign-in required; at least one must exist. |
| Kit Manager | Runs the register: items, locations, check-out and in, inspections, imports, reports. |
| Supervisor | Runs a depot, crew or job: issues and receives kit, records inspections and pre-use checks. |
| Operative | Checks kit out and in and does pre-use checks. Nothing else. |
| Viewer | Read-only. |

Each person works at every depot or only the depots listed, and the database refuses to show them any other. Roles are switches by area (View, Create, Edit, Approve) that an Administrator can change, except the Administrator role itself.

### Browser support

Signed-in pages need JavaScript. Sign-in, first-run set-up and password change work without it. Phone and desktop browsers from the last two years are supported.

### Backups and restore

```sh
sh deploy/backup.sh                                   # writes deploy/backups/northkit-<time>.dump and the files
sh deploy/restore.sh deploy/backups/northkit-<time>.dump --yes
```

Run the backup nightly from cron (the script's header has a line to copy) and copy the dumps off the server. Restore replaces the database, works on a fresh install of the same or a newer version, and upgrades the data on the way in. Backups hold personal data: keep them as safe as the server.

### Licence

The licence is a signed file checked on this server only. Warnings start 60 days before it ends; it keeps working for 30 days after. If it lapses, nothing is deleted and no one is locked out: everything stays visible and exportable, and new work pauses until a renewal is installed in **Settings** (or `pnpm licence:install --file <path>` from the server). Until NorthSpec's signing key exists (`docs/admin/licence-keys.md`), no licence file verifies and every install runs the 30-day evaluation.

### Reporting (Power BI, Excel)

`northkit_readonly` is a read-only database role that reads the documented views in the `reporting` schema (and nothing else) for every depot. Its password is `NORTHKIT_READONLY_DB_PASSWORD` in `deploy/.env`; leave it blank to switch the role off. The database listens on `127.0.0.1:5450` only: connect over an SSH tunnel. Every table and column is described in [`docs/data-dictionary`](docs/data-dictionary/README.md).

## Develop

Node.js 22.12+, pnpm 10 and Docker.

```sh
pnpm install
sh deploy/install.sh                                   # once: deploy/.env with local secrets
docker compose -f deploy/docker-compose.yml up -d db   # PostgreSQL 16 on 127.0.0.1:5450
pnpm db:migrate
pnpm dev                                               # http://localhost:3030
```

To reset the development database (it holds only made-up data), stop anything using it, then drop and recreate it, run every migration and seed it again. Set `SEED_ADMIN_PASSWORD` in `deploy/.env` first:

```sh
docker compose -f deploy/docker-compose.yml stop web worker
docker compose -f deploy/docker-compose.yml exec db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS northkit WITH (FORCE)" -c "CREATE DATABASE northkit"
pnpm db:migrate
pnpm db:seed
```

`pnpm dev` (`next dev`) has no trusted client address, so per-address limits don't apply in development. The production build and the Docker image do apply them.

| Command | What it does |
| --- | --- |
| `pnpm lint && pnpm typecheck && pnpm test` | Before every commit: ESLint and Prettier, TypeScript strict, Vitest on a fresh PostgreSQL database |
| `pnpm build && pnpm test:e2e` | Production build, then Playwright at 1280 wide and 390 × 844 with axe (WCAG 2.2 AA) |
| `pnpm db:check-rls` | Fails if any site-owned table lacks forced row-level security |
| `pnpm db:docs` | Regenerates `docs/data-dictionary` from the database comments; fails on any missing comment |
| `pnpm db:seed` | Development only: three fictional depots and an admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |
| `pnpm db:seed-demo` | Development only: rebuilds `NORTHKIT_DB_NAME` from nothing (it must be a `northkit_*test*` name, normally `northkit_demo_test`), then adds the fictional contractor Fernbrook Contracting: 3 depots, 6 vans, 2 job sites, 9 people; signs in as `demo.admin@northkit.test` with `SEED_DEMO_PASSWORD`. The ~600 items are generated and checked, and stored from Sprint 2 |
| `pnpm demo:user` | Makes the shared demo Administrator on a demo or development database (`docs/demo-link.md`) |
| `pnpm licences:check` | Every installed package's licence against the allow-list |

Workspace: `apps/web` (Next.js), `apps/worker` (pg-boss jobs), `packages/db` (migrations, RLS, Kysely), `packages/core` (services and rules), `packages/licence` (offline licence check).

## Read first

| File | What it is |
| --- | --- |
| `CLAUDE.md` | Instructions for Claude Code in this repo |
| `docs/01-status-and-gates.md` | Where the product is, decisions (K-numbers), gates |
| `docs/02-spec.md` | The product spec: modules, requirement IDs, acceptance tests |
| `docs/03-database-requirements.md` | DB-01 to DB-16 |
| `docs/decisions/` | Architecture decision records |
| `docs/research/` | Competitors, compliance sources, buyer guide, opportunity report |
| `docs/dependencies.md` | Every dependency, its licence and why |
| `prompts/` | The sprint prompts for Claude Code |
