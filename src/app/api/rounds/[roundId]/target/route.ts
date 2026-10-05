import { POSITION_STEPS } from "@/lib/game/constants";
import { one } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertPhase, assertPsychic } from "@/lib/server/guards";
import { loadRound } from "@/lib/server/loadRound";
import { requireActor } from "@/lib/server/session";

/**
 * The Psychic's view of the target.
 *
 * This is the single route in the application that can emit the secret, which
 * is why it is small enough to read in one sitting.
 *
 * Three properties matter here:
 *
 *  1. It is called from a CLIENT component after hydration, never from a
 *     Server Component. RSC flight data is embedded in the page HTML, so
 *     fetching the target during SSR would put it in the document even for the
 *     Psychic — and anyone able to read that page's source.
 *  2. The response is `no-store, private`, so no proxy or bfcache retains it.
 *  3. It is idempotent. The Psychic may call it as often as they like until
 *     the reveal, which is what makes refreshing mid-round safe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ roundId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roundId } = await context.params;
    const round = loadRound(roundId);

    // Identity comes from the httpOnly cookie, never from the request.
    const actor = await requireActor(round.room_id);

    // Both guards matter. The phase check means a target cannot be pulled for
    // a round that has not started; the psychic check is the actual secret.
    assertPhase(round, "clue", "guess", "prediction");
    assertPsychic(round, actor);

    const target = one<{ target_center: number }>(
      "select target_center from round_targets where round_id = ?",
      roundId,
    );
    if (target === null) throw new ApiError("NOT_FOUND", "No target for this round.");
    const steps = target.target_center;

    return Response.json(
      { targetCenter: steps / POSITION_STEPS },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  });
}
