# Deploying to Fly.io

One machine runs everything: the Next.js app, the WebSocket endpoint, and a
SQLite database in a file on a Fly volume. There is no external service to
configure, pay for, or have paused for inactivity.

## One-time setup

```bash
fly auth login
fly apps create wave-length --org personal
fly volumes create wavelength_data --region iad --size 1
```

The volume must be in the app's `primary_region`. 1 GB is far more than a
party game will ever write. Fly snapshots volumes daily and keeps them for 5
days by default; `fly volumes snapshots list <volume-id>` shows them.

Then `fly deploy`. There are no secrets and no build arguments.

## Exactly one machine

A volume belongs to a single machine, so a second machine would get its own,
separate, empty database: players on one would not see rooms created on the
other. `fly.toml` therefore never auto-stops, and the app must stay at one:

```bash
fly scale count 1
```

A deploy restarts that machine in place, a gap of several seconds. Games in
progress survive it — everything is on disk — and clients reconnect their
socket on their own, polling in the meantime.

## Custom domain

The game is served at `wavelength.jaydenlin.net`. Both
`www.wavelength.jaydenlin.net` and the old `wave-length.fly.dev` 308-redirect
to it (see `next.config.ts`). Fly issues the TLS certificates:

```bash
fly certs add wavelength.jaydenlin.net
fly certs add www.wavelength.jaydenlin.net
```

DNS lives at the registrar (Spaceship). Both hosts point at the app's IPs —
`fly ips list` shows them:

| Type | Host             | Value                     |
| ---- | ---------------- | ------------------------- |
| A    | `wavelength`     | `66.241.125.178`          |
| AAAA | `wavelength`     | `2a09:8280:1::195:c661:0` |
| A    | `www.wavelength` | `66.241.125.178`          |
| AAAA | `www.wavelength` | `2a09:8280:1::195:c661:0` |

`fly certs check <host>` reports when validation completes.

## Verifying a deployment

```bash
BASE_URL=https://wavelength.jaydenlin.net node scripts/e2e-api.mjs
BASE_URL=https://wavelength.jaydenlin.net node e2e/no-target-leak.mjs
BASE_URL=https://wavelength.jaydenlin.net node e2e/free-for-all.mjs
```

All three suites take a `BASE_URL`, so the same assertions that guard local
development can be run against production — including the leak sweep.

## Looking at the database

```bash
fly ssh console -C "node -e \"const {DatabaseSync}=require('node:sqlite'); \
  const db=new DatabaseSync('/data/wavelength.db'); \
  console.table(db.prepare('select code, status, created_at from rooms order by rowid desc limit 10').all())\""
```

## Things that bite

**The volume is root-owned.** Fly mounts it as root, so the container starts as
root only long enough to `chown /data`, then drops to an unprivileged user
before Node starts. See the `CMD` in the `Dockerfile`.

**HTTPS is required, not optional.** Session cookies are set `Secure` in
production, so over plain HTTP nobody can join. `force_https` handles it.

**Concurrency counts connections.** Every open game tab holds a WebSocket, so
`fly.toml` limits by connections rather than requests.

**The schema migrates itself.** `server/schema.mjs` holds the migrations and
SQLite's `user_version` records how far a database has got; the server applies
the rest on boot. Append a migration — never edit one that has shipped.
