import { createRoom } from "@/lib/server/rooms";
import { handleRoute } from "@/lib/server/errors";
import { setSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a room. The creator becomes host and is seated on team A. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body: unknown = await request.json().catch(() => ({}));
    const displayName = (body as { displayName?: unknown }).displayName;

    const result = await createRoom(displayName);
    await setSessionCookie(result.roomId, result.token);

    // The token goes in the httpOnly cookie only — never in the body, where
    // script could read it.
    return Response.json(
      { roomId: result.roomId, code: result.code, playerId: result.playerId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
