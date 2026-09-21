import "server-only";

import { POSITION_STEPS } from "@/lib/game/constants";
import { scoreFreeForAllRound, type Guess } from "@/lib/game/free-for-all";

import { serviceClient } from "./db";
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
export async function expectedGuessers(
  roomId: string,
  psychicId: string,
): Promise<string[]> {
  const db = serviceClient();
  const { data } = await db
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .neq("id", psychicId)
    .returns<{ id: string }[]>();
  return (data ?? []).map((player) => player.id);
}

/**
 * Score the round and publish it.
 *
 * Conditional on the round still being in `guess`, so several players
 * committing the last guess at once cannot double-score: one wins, the rest
 * find the round already revealed and simply re-read it.
 */
export async function revealFreeForAll(input: {
  roundId: string;
  roomId: string;
  psychicId: string;
}): Promise<{ revealed: boolean }> {
  const db = serviceClient();

  const { data: targetData, error: targetError } = await db.rpc("take_round_target", {
    p_round_id: input.roundId,
  });
  if (targetError !== null) throw new ApiError("SERVER_ERROR", "Could not read the target.");
  const target = (targetData as { target_center: number }[] | null)?.[0];
  if (target === undefined) throw new ApiError("NOT_FOUND", "No target for this round.");

  const { data: rows } = await db
    .from("round_guesses")
    .select("player_id, position, points")
    .eq("round_id", input.roundId)
    .returns<GuessRow[]>();

  const guesses: Guess[] = (rows ?? []).map((row) => ({
    playerId: row.player_id,
    position: row.position / POSITION_STEPS,
  }));

  const awards = scoreFreeForAllRound(
    target.target_center / POSITION_STEPS,
    input.psychicId,
    guesses,
  );

  // Claim the reveal first. If this returns nothing, someone beat us to it.
  const { data: claimed } = await db
    .from("rounds")
    .update({
      phase: "reveal",
      revealed_target: target.target_center,
      active_points: null,
      opponent_points: null,
      revealed_at: new Date().toISOString(),
    })
    .eq("id", input.roundId)
    .eq("phase", "guess")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (claimed === null) return { revealed: false };

  await Promise.all(
    awards.map(async (award) => {
      if (!award.isPsychic) {
        await db
          .from("round_guesses")
          .update({ points: award.points })
          .eq("round_id", input.roundId)
          .eq("player_id", award.playerId);
      }
      if (award.points > 0) {
        // Read-modify-write is safe here: this runs once per round, inside the
        // single request that won the claim above.
        const { data: player } = await db
          .from("players")
          .select("score")
          .eq("id", award.playerId)
          .maybeSingle<{ score: number }>();
        await db
          .from("players")
          .update({ score: (player?.score ?? 0) + award.points })
          .eq("id", award.playerId);
      }
    }),
  );

  return { revealed: true };
}
