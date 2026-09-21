import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import {
  assertActiveTeam,
  assertController,
  assertNotPsychic,
  assertPhase,
} from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";
import { positionToStepsDb } from "@/lib/server/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Take the dial, or lock in the guess.
 *
 * Note what is absent: there is no endpoint for *moving* the needle. In-flight
 * dragging is a realtime broadcast with no database write at all — persisting
 * 20 rows a second would be pure WAL churn. Only the final locked position is
 * written, and that position is the guess of record.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);
    const db = serviceClient();

    const body: unknown = await request.json().catch(() => ({}));
    const { action, position } = body as { action?: unknown; position?: unknown };

    assertPhase(round, "guess");
    assertActiveTeam(round, actor);
    // The Psychic knows the answer, so they may never touch the dial.
    assertNotPsychic(round, actor);

    if (action === "claim") {
      // Last claim wins, as at a real table where someone just takes the dial.
      const { error } = await db
        .from("rounds")
        .update({ needle_controller_id: actor.playerId })
        .eq("id", roundId)
        .eq("phase", "guess");
      if (error !== null) throw new ApiError("SERVER_ERROR", "Could not take the dial.");
      notifyRoom(round.room_id, "needle-controller");
      return Response.json({ ok: true, controllerId: actor.playerId });
    }

    if (action === "lock") {
      assertController(round, actor);
      if (typeof position !== "number" || !Number.isFinite(position)) {
        throw new ApiError("BAD_REQUEST", "A needle position is required.");
      }
      // Clamped and quantized server-side: the client's number is a request,
      // not a fact.
      const steps = positionToStepsDb(position);

      const { data, error } = await db
        .from("rounds")
        .update({
          needle_position: steps,
          needle_locked_at: new Date().toISOString(),
          phase: "prediction",
        })
        .eq("id", roundId)
        .eq("phase", "guess")
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error !== null) throw new ApiError("SERVER_ERROR", "Could not lock the needle.");
      if (data === null) throw new ApiError("CONFLICT", "The guess was already locked.");
      notifyRoom(round.room_id, "needle-locked");

      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    throw new ApiError("BAD_REQUEST", "Unknown action.");
  });
}
