import "server-only";

import { one } from "./db";
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
  const round = loadRound(roundId);
  const actor = await requireActor(round.room_id);
  return { round, actor };
}

/** The fields every guard needs, or a 404. */
export function loadRound(roundId: string): RoundRow {
  const round = one<RoundRow>(
    `select id, room_id, game_id, phase, active_team, psychic_player_id,
            needle_controller_id, card_id
       from rounds where id = ?`,
    roundId,
  );
  if (round === null) throw new ApiError("NOT_FOUND", "No such round.");
  return round;
}
