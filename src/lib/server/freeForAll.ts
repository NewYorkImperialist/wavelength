import "server-only";

import { POSITION_STEPS } from "@/lib/game/constants";
import { scoreFreeForAllRound, type Guess } from "@/lib/game/free-for-all";

import { all, nowIso, one, run, transaction } from "./db";
import { ApiError } from "./errors";

/**
 * The free-for-all round: everyone commits a guess, then everyone scores.
 *
 * Scoring goes through `@/lib/game/free-for-all`, which in turn uses the same
 * `scoreNeedle` the team game uses. There is still exactly one implementation
 * of where the bands are.
 */

export interface GuessRow {
  readonly player_id: string;
  readonly position: number;
  readonly points: number | null;
}

/** Everyone in the room who is expected to guess this round. */
export function expectedGuessers(roomId: string, psychicId: string): string[] {
  return all<{ id: string }>(
    "select id from players where room_id = ? and left_at is null and id <> ?",
    roomId,
    psychicId,
  ).map((player) => player.id);
}

/**
 * Score the round and publish it.
 *
 * One transaction, conditional on the round still being in `guess`, so
 * several players committing the last guess at once cannot double-score: one
 * reveals, the rest find it already revealed and simply re-read it.
 */
export function revealFreeForAll(input: {
  roundId: string;
  roomId: string;
  psychicId: string;
}): { revealed: boolean } {
  return transaction(() => {
    const target = one<{ target_center: number }>(
      "select target_center from round_targets where round_id = ?",
      input.roundId,
    );
    if (target === null) throw new ApiError("NOT_FOUND", "No target for this round.");

    const claimed = run(
      `update rounds set phase = 'reveal', revealed_target = ?, revealed_at = ?
        where id = ? and phase = 'guess'`,
      target.target_center,
      nowIso(),
      input.roundId,
    );
    if (claimed === 0) return { revealed: false };

    const guesses: Guess[] = all<GuessRow>(
      "select player_id, position, points from round_guesses where round_id = ?",
      input.roundId,
    ).map((row) => ({ playerId: row.player_id, position: row.position / POSITION_STEPS }));

    const awards = scoreFreeForAllRound(
      target.target_center / POSITION_STEPS,
      input.psychicId,
      guesses,
    );

    for (const award of awards) {
      if (!award.isPsychic) {
        run(
          "update round_guesses set points = ? where round_id = ? and player_id = ?",
          award.points,
          input.roundId,
          award.playerId,
        );
      }
      if (award.points > 0) {
        run("update players set score = score + ? where id = ?", award.points, award.playerId);
      }
    }

    return { revealed: true };
  });
}
