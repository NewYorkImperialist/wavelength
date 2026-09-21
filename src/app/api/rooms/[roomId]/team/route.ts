import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Switch teams. Lobby only — letting someone change sides mid-game would
 * scramble the psychic rotation and let a player dodge being Psychic.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);
    const db = serviceClient();

    const body: unknown = await request.json().catch(() => ({}));
    const { team, playerId } = body as { team?: unknown; playerId?: unknown };
    if (team !== "a" && team !== "b") {
      throw new ApiError("BAD_REQUEST", "Pick team a or b.");
    }

    // A player may move themselves; the host may move anyone.
    const subject = typeof playerId === "string" ? playerId : actor.playerId;
    if (subject !== actor.playerId && !actor.isHost) {
      throw new ApiError("FORBIDDEN", "Only the host can move other players.");
    }

    const { data: room } = await db
      .from("rooms")
      .select("status")
      .eq("id", roomId)
      .maybeSingle<{ status: string }>();
    if (room?.status !== "lobby") {
      throw new ApiError("CONFLICT", "Teams are fixed once the game starts.");
    }

    const { data: last } = await db
      .from("players")
      .select("seat_order")
      .eq("room_id", roomId)
      .eq("team", team)
      .order("seat_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ seat_order: number }>();

    const { error } = await db
      .from("players")
      .update({ team, seat_order: (last?.seat_order ?? -1) + 1 })
      .eq("id", subject)
      .eq("room_id", roomId);

    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not switch teams.");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
