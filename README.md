# Wavelength

A browser implementation of the board game **Wavelength** — two teams, a Psychic, a hidden
target on a big analog dial, and the argument that follows.

This is a faithful recreation of the real game's rules and round structure, not a game merely
inspired by it. If you own the physical game you should be able to open this and play without
learning anything new.

> **Assets.** The commercial artwork, logo, fonts and printed card text are copyrighted and are
> not reproduced here. The dial is drawn from scratch in SVG and the spectrum deck is original
> writing. The *rules* are the real rules.

---

## The rules, as implemented

| | |
|---|---|
| **Teams** | Two, alternating turns. |
| **Psychic** | One member of the active team, rotating within the team each round. |
| **Spectrum** | A card with two opposing concepts — `Underrated` ‹———› `Overrated`. |
| **Target** | Randomly placed on a 180° dial. Five wedges: **2 \| 3 \| 4 \| 3 \| 2**. |
| **Clue** | The Psychic sees the target, gives one clue, and the screen closes over it. |
| **Guess** | The active team discusses; one nominated player turns the needle and locks it. |
| **Left / Right** | The *opposing* team then predicts whether the true target centre lies left or right of that needle. |
| **Active score** | The value of the wedge the needle landed in — or **0** if it missed the target entirely. |
| **Opponent bonus** | **1** point for a correct left/right call — **unless the active team hit the 4-point wedge**, which blocks it. |
| **Victory** | First team to **10** points ends the game; the higher score wins. |
| **Ties** | Sudden death: each team takes one more turn, most points that round wins. Repeat until broken. |

Two consequences worth knowing, both of which fall out of the rules rather than being special
cases in the code:

- The opposing team can **win on your turn**, by crossing 10 with their bonus point.
- When the needle sits exactly on the target centre, "left or right" has no answer — but that is
  always a 4, so the bonus is never at stake.

The exact angular width of the physical game's wedges was never published. Here the target spans
**12.5%** of the dial as five equal 2.5% wedges, defined by three integers in
`src/lib/game/constants.ts`.

---

## Architecture

```
src/lib/game/        Pure engine. No React, no Next, no Supabase, no node built-ins.
  constants.ts       Dial geometry, wedge widths, WINNING_SCORE — every magic number, named.
  geometry.ts        Normalized position <-> angle <-> SVG coordinates, arc path building.
  scoring.ts         The ONE authoritative implementation of the scoring rules.
  target.ts          Target generation (RNG injected, never Math.random).
  deck.ts            ~60 original spectrum cards, data only.
  state-machine.ts   transition(room, action) -> { ok, state, effects }
src/lib/server/      import "server-only". Service-role client, auth, guards, round creation.
src/lib/realtime/    Supabase channel hooks and the needle store.
src/components/dial/ The SVG device.
src/app/             Landing page, /room/[code], /local, /api/**
supabase/migrations/
```

### The engine is pure, and that is load-bearing

`transition(room, action)` is a reducer over typed actions. It never throws and never
half-applies — a rejected action returns the *same state object* with an error code. Randomness
lives outside it: the reducer emits an `Effect` (`prepareRound`), and the server interprets that
effect with a CSPRNG.

That purity is what lets the **server and the browser run the identical function** — the server
for authority, the client for optimistic display. Enforced by an ESLint import boundary and by a
test that greps the directory.

### Public vs. secret state

`RoomState` is split in two:

```ts
interface RoomState {
  public: GameState;                    // everyone
  secret: SecretRoundState | null;      // server, and the Psychic's browser only
}
```

Only two actions ever carry a secret. `roundPrepared.targetCenter` is `Position | null`: the
server broadcasts it as `null` to the room and sends the real value to the Psychic alone. Every
other branch of the reducer is secret-blind, so both sides compute a byte-identical public
state. There is a test that asserts exactly this.

---

## Keeping the target secret

The requirement is that a non-Psychic cannot find the target *by any means* before the reveal —
not through the DOM, the network, a direct Supabase query, or a realtime message.

**The `rounds` table has no target column while the round is live.** The secret lives in a
separate `private` Postgres schema, and `rounds.revealed_target_center` is genuinely `NULL` in
the database until the reveal transaction commits. The leak is closed by *absence of data*, not
by a filter.

Three independent barriers, any one of which is sufficient:

1. **PostgREST cannot address it.** `private` is not in the exposed-schemas list, so
   `GET /rest/v1/round_targets` returns `PGRST106` regardless of grants or policies.
2. **No grant.** `anon` and `authenticated` have neither `USAGE` on the schema nor `SELECT` on
   the table.
3. **Not in the realtime publication**, so no WAL record for it ever reaches the Realtime server.

> **Why not just a protected column on `rounds`?** Because Realtime's `postgres_changes` RLS
> check is **row-level only** and does not honour column privileges. The WAL record carries every
> column of the row, so every subscriber would receive the target in the payload even though a
> REST `SELECT` of that column would 403. The invariant to hold in review is: **if it must not be
> seen, it does not live in a table that is in the realtime publication.** Session token hashes
> get the same treatment.

The Psychic fetches the target from `GET /api/rounds/:id/target`, **from a client component after
hydration** — never from a Server Component, because RSC flight data is embedded in the page HTML
and would be trivially greppable. On the client the target wedges are *not rendered at all* for
non-Psychics; they are never hidden with CSS.

`e2e/no-target-leak.spec.ts` plays a real round across four browser contexts and asserts the
Psychic's target value appears in none of: page HTML, any response body, any WebSocket frame,
local/session storage, or the React tree.

---

## Server authority

Clients are never trusted to generate targets, compute scores, change phase, or declare a winner.

Every mutation goes through a Next.js route handler using the service-role key. `anon` and
`authenticated` hold **no** INSERT/UPDATE/DELETE grant anywhere. Each transition is a
*conditional* update gated on the current phase, so two concurrent actions race safely — one
wins, the other gets a 409, and no table locks are needed.

Reads go straight from the browser to Supabase using a short-lived JWT carrying a `room_id`
claim, so RLS scopes every read to your own room.

Players are anonymous: the server mints a 256-bit session token, stores only its SHA-256, and
sets it as an **httpOnly** cookie — so an XSS bug cannot steal a session and impersonate the
Psychic. The display name is never an identifier.

---

## Realtime

Split by frequency, because the needle is the only high-rate thing in the game:

| What | Mechanism |
|---|---|
| Phase, clue, needle lock, prediction, reveal, scores, roster | `postgres_changes` — durable, ordered, RLS-checked |
| Needle dragging (~20 Hz) | `broadcast` — **zero database writes** |
| Who is connected | `presence` |

A refreshing player rebuilds everything from one endpoint, `GET /api/rooms/:id/state`. The
Psychic re-fetches the target on mount, as many times as needed, until the reveal. The in-flight
needle position is deliberately not in the database; it is recovered by a peer echo, falling back
to dial centre.

---

## Local setup

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev
```

`http://localhost:3000/local` plays the complete game on a single screen with no database at all
— useful for rules work and for playing round a laptop.

### Multiplayer

Needs a Postgres + Realtime stack. Locally:

```bash
brew install supabase/tap/supabase
brew install --cask docker      # or: brew install colima docker && colima start
supabase start                  # prints the URL, anon key, service_role key and JWT secret
cp .env.example .env.local      # paste them in
supabase db push
```

Then `pnpm dev` and open `http://localhost:3000`.

---

## Testing

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint, including the engine purity boundary
pnpm check       # all three
pnpm db:test     # apply the migrations to a throwaway DB and attack them
```

`pnpm db:test` needs only a plain PostgreSQL (`brew install postgresql@17 &&
brew services start postgresql@17`) — a small harness stands in for the
Supabase roles and the realtime publication. It applies every migration, seeds
the deck, and then runs fourteen adversarial assertions: that no private table
is published to Realtime, that `rounds.revealed_target` is NULL during play,
that neither `anon` nor `authenticated` can reach the secret table or the
`SECURITY DEFINER` functions, that RLS scopes reads to one room, that a token
with no room claim sees nothing, and that browsers cannot write at all. The
suite is checked against a deliberate hole to confirm it is not passing
vacuously.

The engine tests are exhaustive by design — every scoring boundary is pinned, `scoreNeedle(t, t)`
is checked at all 2001 grid positions, and the state machine is fuzzed to prove it never throws.
Positions are quantized onto a 2000-step integer grid, so scoring compares integers and no
boundary is ever flaky.

---

## Deployment

Vercel-compatible. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET`. The last two are server-only — the absence
of a `NEXT_PUBLIC_` prefix is what keeps Next from inlining them into the client bundle, and
`import "server-only"` in `src/lib/server/` turns any accidental client import into a build error.

---

## Known limitations

**Not yet verified against Supabase itself.** The SQL, grants, RLS policies and
constraints are exercised by `pnpm db:test` against a real PostgreSQL, but two
things can only be confirmed on a Supabase project: that PostgREST refuses the
`private` schema with `PGRST106`, and the actual shape of realtime payloads.
The multiplayer route handlers and client have not been run against a live
database at all.

**No end-to-end browser test yet.** `e2e/no-target-leak.spec.ts` is described in
the security section as the regression guard for the DOM, network, WebSocket
and React-tree channels; it is not written yet.

**Reconnect during the guessing phase is best-effort.** The live needle position
is intentionally not persisted. It is recovered by peer echo, so if every
player refreshes at the same moment the needle returns to the dial centre. The
team simply places it again; the alternative is writing ~20 rows a second.

**Sudden death plays a full pair of turns.** Each team takes exactly one turn per
sudden-death round, which is the published rule, but it means a round can end
with the trailing team having had the last word. That is how the physical game
behaves.

**Spectator mode.** Players without a team are modelled (`team` is nullable) but
there is no dedicated spectator view.
