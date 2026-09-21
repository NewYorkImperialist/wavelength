import "server-only";

import { serviceClient } from "./db";
import { ApiError } from "./errors";
import type { RoundRow } from "./guards";
import { requireActor, type Actor } from "./session";

/**
 * Load a round and authenticate the caller against its room in one step.
 *
 * Every mutating round route starts here, so no route can forget to check
 * that the caller actually belongs to the room the round is in.
 */
export async function loadRoundAndActor(
  roundId: string,
): Promise<{ round: RoundRow; actor: Actor }> {
  const db = serviceClient();

  const { data: round, error } = await db
    .from("rounds")
    .select("id, room_id, game_id, phase, active_team, psychic_player_id, needle_controller_id")
    .eq("id", roundId)
    .maybeSingle<RoundRow>();

  if (error !== null) throw new ApiError("SERVER_ERROR", "Could not load the round.");
  if (round === null) throw new ApiError("NOT_FOUND", "No such round.");

  const actor = await requireActor(round.room_id);
  return { round, actor };
}
