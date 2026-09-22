import { MAX_CLUE_LENGTH } from "@/lib/game/constants";
import { serviceClient } from "@/lib/server/db";
import { notifyRoom } from "@/lib/server/broadcast";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertPhase, assertPsychic } from "@/lib/server/guards";
import { loadRoundAndActor } from "@/lib/server/loadRound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Psychic gives their clue, which closes the screen over the target. */
export async function POST(
  request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const { round, actor } = await loadRoundAndActor(roundId);

    assertPhase(round, "clue");
    assertPsychic(round, actor);

    const body: unknown = await request.json().catch(() => ({}));
    const raw = (body as { clue?: unknown }).clue;
    if (typeof raw !== "string") throw new ApiError("BAD_REQUEST", "A clue is required.");

    // Collapse whitespace and strip control characters, so a clue can't be
    // used to smuggle layout into everyone else's screen.
    const clue = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trim().replace(/\s+/g, " ");
    if (clue.length === 0 || clue.length > MAX_CLUE_LENGTH) {
      throw new ApiError("BAD_REQUEST", `Clues must be 1 to ${MAX_CLUE_LENGTH} characters.`);
    }

    // Conditional on the phase: if two submissions race, one wins and the
    // other gets a 409 rather than overwriting the clue everyone just read.
    //
    // Conditional on the card too, because a vote-skip rewrites the card on
    // this same row. A clue written for the old card must not be recorded
    // against the replacement, which is what would happen if the skip landed
    // in the gap between reading the round above and updating it here.
    const { data, error } = await serviceClient()
      .from("rounds")
      .update({ clue, clue_at: new Date().toISOString(), phase: "guess" })
      .eq("id", roundId)
      .eq("phase", "clue")
      .eq("card_id", round.card_id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not save the clue.");
    if (data === null) {
      throw new ApiError(
        "CONFLICT",
        "The clue was already given, or the room skipped that card.",
      );
    }

    notifyRoom(round.room_id, "clue");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
