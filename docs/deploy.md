# Deploying to Fly.io

The server holds no state. Everything lives in Supabase, and clients are
notified through Supabase Realtime rather than in-process memory, so machines
can scale out, restart or move region without disturbing a game.

## One-time setup

```bash
fly auth login
fly apps create wave-length --org personal
```

`--copy-config` keeps the `fly.toml` in this repo rather than generating a new
one. Pick a region near your players; latency shows up directly in how quickly
the needle moves for everyone else.

## Secrets

Two of the four values are compiled into the browser bundle and two must never
leave the server.

**Server-only** — set as Fly secrets, encrypted at rest and injected at runtime:

```bash
fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."
```

That is the only server secret. Realtime uses broadcast on the anon key and
the server's change notifications carry no data, so there are no custom tokens
to sign and no JWT secret to manage.

**Public** — inlined at build time, so they are `--build-arg`, not secrets.
The anon key is designed to be public: it holds no write grant on any table,
and every read is gated by row level security.

```bash
fly deploy \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

Putting the public values in `fly.toml` under `[build.args]` avoids retyping
them on every deploy.

## Verifying a deployment

```bash
BASE_URL=https://wave-length.fly.dev node scripts/e2e-api.mjs
BASE_URL=https://wave-length.fly.dev node e2e/no-target-leak.mjs
```

Both suites take a `BASE_URL`, so the same assertions that guard local
development can be run against production — including the leak sweep.

## Things that bite

**Cold starts.** `auto_stop_machines = "suspend"` with `min_machines_running = 1`
keeps one machine warm. A party game gets opened by several people within a few
seconds of each other, and a cold start on the first click is the worst
possible first impression. Dropping to zero saves very little.

**HTTPS is required, not optional.** Session cookies are set `Secure` in
production, so over plain HTTP nobody can join. `force_https` handles it.

**Build args are baked in.** Changing a `NEXT_PUBLIC_*` value needs a rebuild,
not just a secret update — those strings are compiled into the JavaScript.

**Region.** Every mutation is a round trip to your Supabase region, and the
reveal is several. Put the Fly app near the database, not near yourself.

**NEXT_PUBLIC_ values are inlined at BUILD time, by static text substitution.**
So they must be read as `process.env.NEXT_PUBLIC_SUPABASE_URL` written out in
full. A computed lookup like `process.env[name]` is not substituted and reads
as undefined inside the container — while working perfectly in development,
where `.env.local` populates `process.env` for real. That cost one deploy;
`src/lib/server/__tests__/env.test.ts` now fails the build if it recurs.
