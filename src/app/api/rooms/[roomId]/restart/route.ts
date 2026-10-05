import { notifyRoom } from "@/lib/server/broadcast";
import { nowIso, one, run, transaction } from "@/lib/server/db";
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

    transaction(() => {
      const game = one<{ id: string; status: string; winner: string | null }>(
        "select id, status, winner from games where room_id = ? order by rowid desc limit 1",
        roomId,
      );
      if (game === null) throw new ApiError("CONFLICT", "There is no game to replay.");
      if (game.winner === null && game.status === "in_game") {
        throw new ApiError("CONFLICT", "That game is still in progress.");
      }

      // Make sure the old game cannot satisfy the "active game" index, so a
      // new one can be created when the host starts again.
      const now = nowIso();
      run("update games set status = 'finished', ended_at = ? where id = ?", now, game.id);

      // A finished game leaves the ROOM as 'in_game' on purpose: rooms only
      // reach 'finished' when abandoned, and that releases the join code —
      // which must not happen while players are still on the game-over screen.
      run(
        `update rooms set status = 'lobby', last_active_at = ?
          where id = ? and status <> 'finished'`,
        now,
        roomId,
      );
    });

    notifyRoom(roomId, "restarted");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
