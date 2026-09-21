import { createRound } from "@/lib/server/createRound";
import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { otherTeam, type DbTeam } from "@/lib/server/guards";
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
    const db = serviceClient();

    const { data: game, error } = await db
      .from("games")
      .select("id, status, winner, current_round_id")
      .eq("room_id", roomId)
      .eq("status", "in_game")
      .maybeSingle<{
        id: string;
        status: string;
        winner: "a" | "b" | null;
        current_round_id: string | null;
      }>();

    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not load the game.");
    if (game === null) throw new ApiError("CONFLICT", "There is no game in progress.");
    if (game.winner !== null) throw new ApiError("CONFLICT", "The game is over.");
    if (game.current_round_id === null) throw new ApiError("CONFLICT", "No round to advance from.");

    // Only a revealed round can be closed out, and only once: the first caller
    // flips it to 'complete' and the rest get a 409.
    const { data: closed, error: closeError } = await db
      .from("rounds")
      .update({ phase: "complete" })
      .eq("id", game.current_round_id)
      .eq("phase", "reveal")
      .select("round_number, active_team")
      .maybeSingle<{ round_number: number; active_team: DbTeam }>();

    if (closeError !== null) throw new ApiError("SERVER_ERROR", "Could not close the round.");
    if (closed === null) throw new ApiError("CONFLICT", "That round is not ready to advance.");

    const { roundId } = await createRound({
      roomId,
      gameId: game.id,
      roundNumber: closed.round_number + 1,
      activeTeam: otherTeam(closed.active_team),
    });

    await db.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", roomId);

    notifyRoom(roomId, "next-round");

    return Response.json(
      { roundId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
