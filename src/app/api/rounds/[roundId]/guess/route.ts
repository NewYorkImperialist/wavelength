import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertPhase } from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";
import { expectedGuessers, revealFreeForAll } from "@/lib/server/freeForAll";
import { positionToStepsDb } from "@/lib/server/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Commit your own guess.
 *
 * Free-for-all has no shared needle: everyone places their own and the round
 * reveals once the last person has committed. Dragging is still broadcast so
 * the room can see each other's needles move, but only what is written here
 * counts.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);
    const db = serviceClient();

    assertPhase(round, "guess");
    // The Psychic knows where the target is, so they never guess.
    if (round.psychic_player_id === actor.playerId) {
      throw new ApiError("FORBIDDEN", "The Psychic doesn't guess.");
    }

    const body: unknown = await request.json().catch(() => ({}));
    const position = (body as { position?: unknown }).position;
    if (typeof position !== "number" || !Number.isFinite(position)) {
      throw new ApiError("BAD_REQUEST", "A needle position is required.");
    }

    // Once committed, a guess is final — otherwise you could wait to see the
    // reveal stall and keep adjusting.
    const { error } = await db.from("round_guesses").insert({
      round_id: roundId,
      player_id: actor.playerId,
      position: positionToStepsDb(position),
    });

    if (error !== null) {
      if (error.code === "23505") throw new ApiError("CONFLICT", "You already locked in.");
      throw new ApiError("SERVER_ERROR", "Could not record your guess.");
    }

    // Reveal when nobody is left to wait for.
    const waitingFor = await expectedGuessers(round.room_id, round.psychic_player_id);
    const { count: committed } = await db
      .from("round_guesses")
      .select("player_id", { count: "exact", head: true })
      .eq("round_id", roundId);

    if ((committed ?? 0) >= waitingFor.length) {
      await revealFreeForAll({
        roundId,
        roomId: round.room_id,
        psychicId: round.psychic_player_id,
      });
    }

    notifyRoom(round.room_id, "guess");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
