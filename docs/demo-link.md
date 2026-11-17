# The demo link

How NorthKit is shown from Chris's own PC through a Cloudflare Tunnel, with Cloudflare
Access (email one-time code) in front so only invited people get in. Fictional demo data
only, never customer data. This is a demo, not hosting (#60 is still undecided).

| | |
| --- | --- |
| Demo address | https://northkit-demo.northspec.co.uk |
| Tunnel's service URL | `http://localhost:3030` |
| What it shows | `pnpm dev` (the development server), so changes show straight away |
| Database | `northkit_demo_test`: the fictional demo company (3 depots, 6 vans, 9 people) from `pnpm db:seed-demo` |

## Settings (in `deploy/.env`, which is git-ignored)

```sh
NORTHKIT_DB_NAME=northkit_demo_test
NORTHKIT_DEMO_ORIGIN=https://northkit-demo.northspec.co.uk
NORTHKIT_PUBLIC_URL=https://northkit-demo.northspec.co.uk
NORTHKIT_COOKIE_SECURE=true
DEMO_SHARED_PASSWORD=<from Bitwarden>
```

- `NORTHKIT_DEMO_ORIGIN` lets the dev server serve its scripts to that address, accepts it
  for form posts and the phone's sync, trusts the tunnel (which connects from 127.0.0.1 or
  ::1) to name the visitor in `Cf-Connecting-Ip` for rate limits and the audit log, and
  shows a thin "Demo, fictional data" strip on that address only. Forwarded headers from
  anywhere else are ignored, as before (D15).
- **Development server only.** The loopback trust is only safe on this PC, so the production
  build (`next start`, the standalone server) and the Docker web container refuse to start
  while `NORTHKIT_DEMO_ORIGIN` is set, with an error saying so; remove it to start them.
  `pnpm dev` starts, and prints a warning naming the trusted addresses (127.0.0.1 and ::1).
  A production build never carries the demo address either: `next.config.ts` only applies
  it to the development server.
- `NORTHKIT_PUBLIC_URL` makes QR posters, labels and email links point at the demo address.
- Secure cookies stay on: the browser sees HTTPS. `http://localhost:3030` still works,
  because browsers allow secure cookies on localhost.

## Start it

```sh
docker compose -f deploy/docker-compose.yml stop web worker   # frees port 3030; the db keeps running
pnpm dev                                                      # http://localhost:3030 and the demo address
```

Optional, for the daily jobs (audit partitions, old sessions) while demoing: `pnpm --filter @northkit/worker start`
in a second terminal.

`pnpm dev` runs `next dev` with the same connecting-address preload as the production server
(`apps/web/scripts/dev.mjs`).

### Why not the Docker stack for the demo

It refuses to start with the demo link set (above). The reasons: the Docker web container
is published on `0.0.0.0:3030`, and inside the container a visit through the tunnel
arrives from Docker's own gateway address, not from loopback. So the tunnel can't be told
apart from anyone else on the network, and the port can be reached around Cloudflare
Access from the local network. Stop the `web` and `worker` containers while demoing (the
start commands above); the `db` container keeps running and serves `pnpm dev`.

## The shared demo user

`pnpm demo:user` makes (or updates) the Administrator **demo@northspec.test** with the
password in `DEMO_SHARED_PASSWORD`, on the database in `NORTHKIT_DB_NAME`. It refuses any
database whose name doesn't say demo or dev (such as `northkit_demo_test`) and any password
under 12 characters, hashes it with Argon2id and never prints it. Run it again after changing
the password to change it; that also signs the demo user out everywhere.

Two-factor is required for Administrators, as on every install: set up the authenticator
once on the first sign-in. There is no bypass. The password lives in Bitwarden, never in this
repo.

The seeded demo users (for example `demo.admin@northkit.test`) are left as they are.

## Reset the demo data

```sh
pnpm db:seed-demo      # rebuilds northkit_demo_test from nothing (needs SEED_DEMO_PASSWORD)
pnpm demo:user         # then make the shared demo user again
```

Do not add Cloudflare tokens, tunnel ids or passwords to the repo.
