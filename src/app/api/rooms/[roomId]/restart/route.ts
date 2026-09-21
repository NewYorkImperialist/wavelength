import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertHost } from "@/lib/server/guards";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Play again with the same people.
 *
 * Returns the room to the lobby rather than starting immediately, so players
 * can change teams between games — which the physical game does naturally and
 * which teams cannot do mid-game.
 *
 * The finished game and its rounds are left in place. They are the record of
 * what happened, and nothing reads them once a new game exists.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);
    assertHost(actor);

    const db = serviceClient();

    const { data: game } = await db
      .from("games")
      .select("id, status, winner")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; status: string; winner: string | null }>();

    if (game === null) throw new ApiError("CONFLICT", "There is no game to replay.");
    if (game.winner === null && game.status === "in_game") {
      throw new ApiError("CONFLICT", "That game is still in progress.");
    }

    // Make sure the old game cannot satisfy the "active game" index, so a new
    // one can be created when the host starts again.
    await db
      .from("games")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", game.id);

    // A finished game leaves the ROOM as 'in_game' on purpose: rooms only
    // reach 'finished' when abandoned, and that releases the join code — which
    // must not happen while players are still sitting on the game-over screen.
    const { error } = await db
      .from("rooms")
      .update({ status: "lobby", last_active_at: new Date().toISOString() })
      .eq("id", roomId)
      .neq("status", "finished");

    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not reset the room.");

    notifyRoom(roomId, "restarted");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
