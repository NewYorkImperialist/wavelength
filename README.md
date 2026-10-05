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
| **Players** | Two upward. Four or more can split into teams; smaller groups play co-op. |
| **Teams** | Two, alternating turns — or everyone on one side in co-op. |
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

## Co-op

The full game needs four people, because the Psychic's own team does the
guessing. With one player per team that player would be Psychic *and* the only
guesser, moving the needle while looking at the target — so literal 1v1 is not
a game.

Co-op is the published answer and needs no rule invention: everyone on one
side, one gives the clue, the rest move the needle, and the round goes
straight from the locked guess to the reveal because there is no opposing team
to call left or right. Two, three or five players all work.

It is derived from the roster rather than stored as a mode flag, so a game
cannot end up in a state its player list contradicts. Joining seats everyone
on one side by default — auto-balancing would leave two players at one apiece,
the single configuration that cannot be played — and the host can split into
two teams once there are four.

## Architecture

```
src/lib/game/        Pure engine. No React, no Next, no database, no node built-ins.
  constants.ts       Dial geometry, wedge widths, WINNING_SCORE — every magic number, named.
  geometry.ts        Normalized position <-> angle <-> SVG coordinates, arc path building.
  scoring.ts         The ONE authoritative implementation of the scoring rules.
  target.ts          Target generation (RNG injected, never Math.random).
  deck.ts            ~60 original spectrum cards, data only.
  state-machine.ts   transition(room, action) -> { ok, state, effects }
src/lib/server/      import "server-only". Database access, auth, guards, round creation.
src/lib/realtime/    The room hook: WebSocket pings, presence, polling fallback.
src/components/dial/ The SVG device.
src/app/             Landing page, /room/[code], /local, /api/**
server/              The custom server: Next + the /ws endpoint, SQLite, the schema.
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
not through the DOM, the network, or a realtime message.

**The `rounds` table has no target column while the round is live.** The secret lives in a
separate `round_targets` table that only three pieces of code name — round creation, the
Psychic's target endpoint, and the reveal — and `rounds.revealed_target` is genuinely `NULL` until
the reveal transaction commits. The leak is closed by *absence of data*, not by a filter: no
query of `rounds`, however careless, can return the secret.

Nothing reaches a browser except through the API routes, and every room-state response goes
through one allow-list mapper. The WebSocket carries no game data at all — only "something
changed" pings and who is online.

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

Every mutation goes through a Next.js route handler, and browsers never touch the database.
Each transition runs in a single synchronous SQLite transaction gated on the current phase, so
two concurrent actions race safely — one wins, the other gets a 409. Because `node:sqlite` is
synchronous and the server is one process, a transaction with no `await` inside it cannot
interleave with another request at all.

Players are anonymous: the server mints a 256-bit session token, stores only its SHA-256, and
sets it as an **httpOnly** cookie — so an XSS bug cannot steal a session and impersonate the
Psychic. The display name is never an identifier.

---

## Realtime

One WebSocket per player, served by the same process as the app (`server/index.mjs`), carrying:

| What | Message |
|---|---|
| Anything changed | `changed` — a bare ping from the server, carrying **no data** |
| Who is connected | `presence` — the player ids with the room open |

A change notification carries no game state: clients react by re-fetching
`/api/rooms/:id/state`, which is the single place that decides what a given
player may see. A ping cannot leak; a row payload can.

The socket is authenticated by the same httpOnly session cookie the API uses,
and refused for anyone not seated in the room or connecting from another site.

Dial dragging is deliberately **not** relayed. Everyone guesses on their own
dial, and broadcasting it live would hand a late guesser everyone else's
answer — exactly what the room state withholds until the reveal.

A refreshing player rebuilds everything from one endpoint, `GET /api/rooms/:id/state`. The
Psychic re-fetches the target on mount, as many times as needed, until the reveal.

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

Nothing to set up. `pnpm dev` runs the custom server, which creates a SQLite
database at `data/wavelength.db` on first use (set `DATABASE_PATH` to put it
elsewhere). Open `http://localhost:3000`.

---

## Testing

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint, including the engine purity boundary
pnpm check       # all three
pnpm test:api    # play a full game over HTTP against a running server
pnpm test:leak   # four real browsers; hunt the target through every channel
pnpm test:ffa    # four real browsers; a full free-for-all round
```

The three end-to-end suites take a `BASE_URL` and default to
`http://localhost:3000`, so run `pnpm dev` first — or point them at production.

`pnpm test:api` runs four players through complete rounds in four cookie
jars, asserting every guard: that only the Psychic receives the target and
everyone else gets a 403 in every phase, that the target appears nowhere in
public state until the reveal, that refusals leak nothing, that the Psychic
cannot guess, that a locked guess cannot be moved, that a clue cannot be
rewritten, that a vote-skip deals a fresh card and commitment, and that a
forged cookie is rejected. Scores are re-derived independently and compared
with what the server stored.

`src/lib/server/__tests__/database.test.ts` runs the data layer against an
in-memory SQLite: that the target never lands in `rounds` and matches its
published commitment, that a reveal scores exactly once, and that a reroll
moves card, target and commitment together or not at all.

The engine tests are exhaustive by design — every scoring boundary is pinned, `scoreNeedle(t, t)`
is checked at all 2001 grid positions, and the state machine is fuzzed to prove it never throws.
Positions are quantized onto a 2000-step integer grid, so scoring compares integers and no
boundary is ever flaky.

---

## Deployment

Fly.io, one machine with a volume holding the SQLite file — see
[docs/deploy.md](docs/deploy.md). There are no secrets to configure.

---

## Known limitations

**The engine is faithful; the social rules are not enforced.** The Psychic is
asked not to gesture or use the words on the dial, but nothing stops them.
That is true of the physical game too.

**Polling is the floor, not the ceiling.** If the WebSocket is unavailable — a
blocking proxy, a dropped connection, the server restarting for a deploy — the
room falls back to polling every 2s and stays fully playable.

**One machine.** The database is a file on that machine's volume, so the app
cannot scale out to a second one. For a party game that is plenty, and it is
what makes everything else simple.

**Sudden death plays a full pair of turns.** Each team takes exactly one turn per
sudden-death round, which is the published rule, but it means a round can end
with the trailing team having had the last word. That is how the physical game
behaves.

**Spectator mode.** Players without a team are modelled (`team` is nullable) but
there is no dedicated spectator view.
