# The demo link

How NorthKit is shown from Chris's own PC through a Cloudflare Tunnel, with Cloudflare Access (email one-time code) in front so only invited people get in. Fictional demo data only (Fernbrook Contracting, `pnpm db:seed-demo`), never customer data. This is a demo, not hosting.

| | |
| --- | --- |
| Demo address | https://northkit-demo.northspec.co.uk (set in `deploy/.env.demo`, never hard-coded) |
| Tunnel's service URL | `http://localhost:3030` |
| Settings file | `deploy/.env.demo` (git-ignored; copy `deploy/.env.demo.example`). **The normal install's `deploy/.env` never needs a demo line.** |
| Two ways to run it | `pnpm demo` (the development server, changes show straight away) or `pnpm demo:docker` (the Docker demo profile, its own database) |

## What goes in `deploy/.env.demo`

Copy `deploy/.env.demo.example` to `deploy/.env.demo` and fill in:

```sh
NORTHKIT_DEMO_ORIGIN=https://northkit-demo.northspec.co.uk
NORTHKIT_PUBLIC_URL=https://northkit-demo.northspec.co.uk
NORTHKIT_DB_NAME=northkit_demo_test
NORTHKIT_COOKIE_SECURE=true
NORTHKIT_DEMO_PORT=3030
DEMO_SHARED_PASSWORD=<from Bitwarden, 12 characters or more>
# Only for `pnpm demo:docker` (its own database and volumes):
DEMO_POSTGRES_PASSWORD=<a fresh random value>
DEMO_APP_DB_PASSWORD=<a fresh random value>
DEMO_SECRET_KEY=<32 random bytes, base64>
SEED_DEMO_PASSWORD=<a fresh random value: every seeded demo person signs in with it>
```

Make each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (the secret key with `.toString('base64')`). Nothing is read from anywhere else, and nothing here is ever committed. If `deploy/.env` still has a `NORTHKIT_DEMO_ORIGIN=` line, remove it: the normal Docker install refuses to start while it is there (as designed).

## `pnpm demo`: the development server

```sh
docker compose -f deploy/docker-compose.yml stop web worker   # frees port 3030; the db keeps running
pnpm db:seed-demo                                             # once, or to reset the demo data
pnpm demo                                                     # http://localhost:3030 and the demo address
```

It loads `deploy/.env.demo` (its values win over `deploy/.env` for this command; the database passwords still come from `deploy/.env`), checks the shared demo Administrator (left alone when its password already matches, so starting the demo signs nobody out), then starts `next dev` on the demo port. Optional, for thumbnails and imports while demoing: `pnpm --filter @northkit/worker start` in a second terminal.

## `pnpm demo:docker`: the Docker demo profile (K19)

```sh
pnpm demo:docker            # first run seeds the fictional company; later runs just start it
pnpm demo:docker --reset    # seeds it again from nothing
```

It runs `docker compose --profile demo` with `deploy/.env` and `deploy/.env.demo`. The profile has its own services and volumes, so nothing touches the normal install's database or files:

- `db-demo`: its own PostgreSQL, with its own volume.
- `demo-seed`: rebuilds the demo database from nothing (`pnpm db:seed-demo`) and makes the shared demo user.
- `web-demo` and `worker-demo`: the same images as a customer install.
- `demo-proxy`: a small proxy **in the same network namespace as `web-demo`**. Inside Docker a visit arrives from the bridge gateway, never from loopback, so the proxy connects to the app over loopback, and the app trusts loopback only. Only the proxy's port is published, on `127.0.0.1` of this PC, so the tunnel (running on this PC) is the only way in. Headers pass straight through: the tunnel's `X-Forwarded-Proto` and `Cf-Connecting-Ip` reach the app, which records the visitor's address from them.

The production guard stays (K15). A normal web container, and any production-mode server, still **refuses to start while `NORTHKIT_DEMO_ORIGIN` is set**. The demo profile is the one exception, and it asks for it explicitly: `NORTHKIT_DEMO_SIDECAR=1` **and** a database whose name says demo or development (`northkit_demo_test`, never a customer's). Anything else still refuses. A visit from any non-loopback address is never believed, with or without the flag.

If `pnpm demo:docker` says the port is in use, stop the normal install's web service (`docker compose -f deploy/docker-compose.yml stop web worker`), or set `NORTHKIT_DEMO_PORT` to another port and point the tunnel at it.

Stop it with `docker compose -f deploy/docker-compose.yml --profile demo stop web-demo demo-proxy worker-demo db-demo`.

## What the demo link changes

- `NORTHKIT_DEMO_ORIGIN` is accepted as well as localhost for server actions, trusts the tunnel (which connects from `127.0.0.1` or `::1`) to name the visitor in `Cf-Connecting-Ip` for rate limits and the audit log, and shows a thin "Demo, fictional data" strip on that address only. Forwarded headers from anywhere else are ignored.
- `NORTHKIT_PUBLIC_URL` makes label QR codes and links point at the demo address.
- Secure cookies stay on: the browser sees HTTPS. `http://localhost:3030` still works, because browsers allow secure cookies on localhost.

## The shared demo user

`pnpm demo:user` makes (or updates) the Administrator **demo@northspec.test** with the password in `DEMO_SHARED_PASSWORD`, on the database in `NORTHKIT_DB_NAME`. It refuses any database whose name doesn't say demo or dev and any password under 12 characters, hashes it with Argon2id and never prints it. With `--check` it leaves the user alone when the password already matches. Running it with a new password changes it and signs the demo user out everywhere.

Two-factor is required for Administrators, as on every install: set up the authenticator once on the first sign-in. There is no bypass. The seeded demo people (for example `demo.kitmanager@northkit.test`, with `SEED_DEMO_PASSWORD`) are left as they are.

## Reset the demo data

```sh
pnpm db:seed-demo      # rebuilds NORTHKIT_DB_NAME from nothing (it must be a northkit_*test* name)
pnpm demo:user         # then make the shared demo user again
# or, for the Docker demo: pnpm demo:docker --reset
```

Running it twice gives the same company: the data is generated from a fixed seed and the photo files have fixed names.

Do not add Cloudflare tokens, tunnel ids or passwords to the repo.
