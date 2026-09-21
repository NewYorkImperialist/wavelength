# Using your own spectrum deck

The built-in deck in `src/lib/game/deck.ts` is 120 original spectrums. The
printed text of the commercial game is copyrighted and is not included, but
nothing stops you from playing with your own list — including one you transcribe
from a copy you own. Keep that file out of version control if it isn't yours to
publish.

## Format

A JSON array, or an object with a `cards` array:

```json
[
  { "id": "my-001", "left": "Underrated", "right": "Overrated" },
  { "left": "Bad hiding place", "right": "Good hiding place" }
]
```

| Field | Required | Notes |
|---|---|---|
| `left` | yes | Non-empty string. The concept at position 0 on the dial. |
| `right` | yes | Non-empty string. The concept at position 1. |
| `id` | no | Stable identifier. Generated as `custom-001`, `custom-002`… when omitted. |

Validation is lenient by design: bad rows are skipped and reported rather than
failing the whole load.

```ts
import { parseDeck } from "@/lib/game/deck";

const { cards, errors } = parseDeck(JSON.parse(text));
if (errors.length > 0) console.warn(errors);
```

Duplicate ids, and duplicate `left`/`right` pairs compared case-insensitively,
are rejected so the same spectrum cannot come up twice in a game.

## What makes a good spectrum

The dial answers "where does this belong between these two poles", so a
spectrum needs to be arguable rather than factual.

- **Good:** `Chore / Treat`, `Temporary fix / Permanent fix`, `Cute animal /
  Terrifying animal`. Everyone has an opinion and opinions differ a little.
- **Bad:** anything with a correct answer (`Small / Large` for measurable
  objects), anything requiring outside knowledge, or poles that aren't really
  opposites.

Both ends should be a positive statement of something, not a thing and its
negation — `Forgettable / Unforgettable` works; `Fun / Not fun` doesn't.

## Loading a custom deck

**Single-screen game** (`/local`): pass the parsed cards where the built-in
`SPECTRUM_DECK` is used.

**Multiplayer:** cards live in the `spectrum_cards` table so every client
resolves the same card id. Seed your deck there:

```bash
psql "$DATABASE_URL" -c "\copy spectrum_cards(left_label,right_label) FROM 'deck.csv' CSV HEADER"
```

Cards are drawn without repeats within a game; the deck reshuffles rather than
erroring if a game somehow outlasts it.
