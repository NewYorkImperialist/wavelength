# Ideas, parked

Things worth building that are deliberately not built yet.

---

## Solo / co-op mode with a bot instead of a second team

**Status:** idea only, nothing implemented.

The two-team structure is faithful to the physical game, but it needs at least
four people to feel right. A mode where one side is a bot would make the game
playable by two friends, or one person, which is probably when people actually
want to open a browser game.

### The thing to solve first

The opposing team is not decoration — it owns the **left/right call**, which is
one of the two scoring mechanics. Remove the second team and you have to decide
what happens to it. Three options, in rough order of how much they change the
game:

1. **Bot makes the left/right call.** Closest to the real game and the least
   work. A bot that guesses randomly is a 50/50 coin flip that adds nothing; a
   bot that guesses *well* needs a model of where a clue sits on a spectrum,
   which is the hard part of the whole game. A reasonable middle ground: bias
   the call by how far the needle is from centre, since an extreme guess is
   more likely to have overshot.

2. **Drop the second team; keep the target and scoring.** This is the published
   **co-op mode**: one team, play through a fixed number of cards, add up the
   score and try to beat it next time. No left/right call at all. Faithful,
   because it is a real mode of the physical game, and it needs no bot — just a
   different victory condition. **This is probably the right first move**, and
   it is a much smaller change than it sounds: the engine already separates
   scoring from turn order.

3. **Bot as a full second team, including being Psychic.** Requires generating
   clues, which means a language model in the loop and a completely different
   cost and latency profile. Interesting, but a separate project.

### What it would touch

The engine is already shaped for this. `transition()` doesn't care who
dispatches an action, only that the guards pass, so a bot is just something
that calls `submitPrediction` on a timer. The pieces that would change:

- `GameState.teams` assumes exactly two — a co-op mode would need the victory
  check in `applyReveal` to branch on a mode flag rather than comparing two
  scores.
- `scoreOpponentPrediction` would simply not be called in co-op.
- `nextPsychicId` already handles a team of one.

### Open question

Whether this replaces the two-team game or sits alongside it. The current build
treats two teams as the default because that is what the physical game is; if
the bot version turns out to be the one people actually play, the default
should probably flip.
