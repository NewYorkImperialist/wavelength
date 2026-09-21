import { handleRoute } from "@/lib/server/errors";
import { loadRoomState } from "@/lib/server/roomState";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The one endpoint a client needs to rebuild itself after a load or refresh. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);
    const state = await loadRoomState(actor);

    return Response.json(state, { headers: { "Cache-Control": "no-store, private" } });
  });
}
