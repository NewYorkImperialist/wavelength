import { serviceClient } from "@/lib/server/db";
import { notifyRoom } from "@/lib/server/broadcast";
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
    const { team, playerId, split } = body as {
      team?: unknown;
      playerId?: unknown;
      split?: unknown;
    };

    const { data: roomForSplit } = await db
      .from("rooms")
      .select("status")
      .eq("id", roomId)
      .maybeSingle<{ status: string }>();
    if (roomForSplit?.status !== "lobby") {
      throw new ApiError("CONFLICT", "Teams are fixed once the game starts.");
    }

    // Deal the roster into two sides, keeping join order so the split feels
    // predictable rather than random.
    if (split === true) {
      if (!actor.isHost) throw new ApiError("FORBIDDEN", "Only the host can split the teams.");

      const { data: roster } = await db
        .from("players")
        .select("id")
        .eq("room_id", roomId)
        .is("left_at", null)
        .order("created_at", { ascending: true })
        .returns<{ id: string }[]>();

      const everyone = roster ?? [];
      if (everyone.length < 4) {
        throw new ApiError("CONFLICT", "You need four players to split into teams.");
      }

      const half = Math.ceil(everyone.length / 2);
      await Promise.all(
        everyone.map((player, index) =>
          db
            .from("players")
            .update(
              index < half
                ? { team: "a", seat_order: index }
                : { team: "b", seat_order: index - half },
            )
            .eq("id", player.id),
        ),
      );

      notifyRoom(roomId, "teams-split");
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (team !== "a" && team !== "b") {
      throw new ApiError("BAD_REQUEST", "Pick team a or b.");
    }

    // A player may move themselves; the host may move anyone.
    const subject = typeof playerId === "string" ? playerId : actor.playerId;
    if (subject !== actor.playerId && !actor.isHost) {
      throw new ApiError("FORBIDDEN", "Only the host can move other players.");
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
    notifyRoom(roomId, "team-changed");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
