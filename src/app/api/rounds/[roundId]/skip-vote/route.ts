import { notifyRoom } from "@/lib/server/broadcast";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertPhase } from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";
import { resolveSkipVotes, setSkipVote } from "@/lib/server/skipVote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vote to throw this card away.
 *
 * Some spectrums cannot be clued by the player who drew them, and the only
 * escape used to be restarting the game. A strict majority deals a
 * replacement to the same Psychic — drawing a bad card should not cost anyone
 * their turn.
 *
 * Anyone in the room may vote, the Psychic included: they are usually the one
 * who knows the card is hopeless, and letting them skip alone would hand them
 * unlimited redraws.
 *
 * Only during `clue`. Once the clue is out, the room has read the card and
 * guessing it is the game; a skip then would let a Psychic who miscalled their
 * own clue take a second attempt at the same turn.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);

    assertPhase(round, "clue");

    const body: unknown = await request.json().catch(() => ({}));
    const voting = (body as { voting?: unknown }).voting;
    if (typeof voting !== "boolean") {
      throw new ApiError("BAD_REQUEST", "Say whether you are voting to skip.");
    }

    await setSkipVote({
      roundId,
      playerId: actor.playerId,
      cardId: round.card_id,
      voting,
    });

    // The vote and the decision are one request: there is nothing else to
    // press, and a tally that carried but sat waiting would just be a stall.
    const { tally, skipped } = await resolveSkipVotes({
      roomId: round.room_id,
      roundId,
      gameId: round.game_id,
      cardId: round.card_id,
    });

    notifyRoom(round.room_id, skipped ? "card-skipped" : "skip-vote");

    return Response.json(
      { votes: tally.voterIds.length, required: tally.required, skipped },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
