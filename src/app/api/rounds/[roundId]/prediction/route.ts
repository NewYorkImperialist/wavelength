import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertOpposingTeam, assertPhase } from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";
import { revealAndScore } from "@/lib/server/resolveRound";
import { stepsToPosition } from "@/lib/server/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The opposing team calls left or right — and the target is revealed.
 *
 * These are one request on purpose. Splitting them would leave a window in
 * which the call is locked but the target is still hidden, and some client
 * would have to decide to close it; if that client disconnected, the round
 * would hang. Doing both here also means the target enters the database, and
 * therefore the realtime payload, only once the call is already committed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);
    const db = serviceClient();

    assertPhase(round, "prediction");
    assertOpposingTeam(round, actor);

    const body: unknown = await request.json().catch(() => ({}));
    const side = (body as { side?: unknown }).side;
    if (side !== "left" && side !== "right") {
      throw new ApiError("BAD_REQUEST", "Call either left or right.");
    }

    // Conditional on the prediction still being unset, so the first call wins
    // and a second player cannot overwrite it.
    const { data: claimed, error } = await db
      .from("rounds")
      .update({
        prediction: side,
        prediction_by: actor.playerId,
        prediction_at: new Date().toISOString(),
      })
      .eq("id", roundId)
      .eq("phase", "prediction")
      .is("prediction", null)
      .select("id, needle_position")
      .maybeSingle<{ id: string; needle_position: number | null }>();

    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not record the call.");
    if (claimed === null) throw new ApiError("CONFLICT", "That call was already made.");
    if (claimed.needle_position === null) {
      throw new ApiError("CONFLICT", "The needle was never locked.");
    }

    const outcome = await revealAndScore({
      roundId,
      gameId: round.game_id,
      activeTeam: round.active_team,
      needleSteps: claimed.needle_position,
      prediction: side,
    });

    notifyRoom(round.room_id, "revealed");

    return Response.json(
      {
        targetCenter: stepsToPosition(outcome.targetSteps),
        activePoints: outcome.activePoints,
        opponentPoints: outcome.opponentPoints,
        scoreA: outcome.scoreA,
        scoreB: outcome.scoreB,
        winner: outcome.winner,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
