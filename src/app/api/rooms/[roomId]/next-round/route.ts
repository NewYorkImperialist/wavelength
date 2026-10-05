import { createRound } from "@/lib/server/createRound";
import { notifyRoom } from "@/lib/server/broadcast";
import { nowIso, one, run, transaction } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import type { DbTeam } from "@/lib/server/guards";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Move on from the reveal: swap the active team and deal a new round.
 *
 * Anyone in the room may advance — waiting on one specific player would stall
 * the game if they closed their laptop. The conditional update makes it safe
 * for several people to press it at once.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    await requireActor(roomId);

    const { roundId } = transaction(() => {
      const game = one<{ id: string; winner: "a" | "b" | null; current_round_id: string | null }>(
        "select id, winner, current_round_id from games where room_id = ? and status = 'in_game'",
        roomId,
      );
      if (game === null) throw new ApiError("CONFLICT", "There is no game in progress.");
      if (game.winner !== null) throw new ApiError("CONFLICT", "The game is over.");
      if (game.current_round_id === null) {
        throw new ApiError("CONFLICT", "No round to advance from.");
      }

      // Only a revealed round can be closed out, and only once: the first
      // caller flips it to 'complete' and the rest get a 409.
      const closed = one<{ round_number: number; active_team: DbTeam }>(
        `update rounds set phase = 'complete'
          where id = ? and phase = 'reveal'
          returning round_number, active_team`,
        game.current_round_id,
      );
      if (closed === null) throw new ApiError("CONFLICT", "That round is not ready to advance.");

      // No teams to alternate between: the same side plays every round and
      // only the Psychic rotates.
      const created = createRound({
        roomId,
        gameId: game.id,
        roundNumber: closed.round_number + 1,
        activeTeam: closed.active_team,
      });

      run("update rooms set last_active_at = ? where id = ?", nowIso(), roomId);
      return created;
    });

    notifyRoom(roomId, "next-round");

    return Response.json(
      { roundId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
