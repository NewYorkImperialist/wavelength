import { notifyRoom } from "@/lib/server/broadcast";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertHost, assertPhase } from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";
import { revealFreeForAll } from "@/lib/server/freeForAll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reveal without waiting for everyone.
 *
 * Someone always wanders off mid-round. Without this the room waits forever
 * on a guess that is not coming, and the only escape is starting over.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);

    assertPhase(round, "guess");
    assertHost(actor);

    const { revealed } = await revealFreeForAll({
      roundId,
      roomId: round.room_id,
      psychicId: round.psychic_player_id,
    });
    if (!revealed) throw new ApiError("CONFLICT", "That round was already revealed.");

    notifyRoom(round.room_id, "revealed");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
