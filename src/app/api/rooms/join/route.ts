import { handleRoute } from "@/lib/server/errors";
import { joinRoom } from "@/lib/server/rooms";
import { setSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Join an existing room by its short code. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body: unknown = await request.json().catch(() => ({}));
    const { code, displayName } = body as { code?: unknown; displayName?: unknown };

    const result = await joinRoom(code, displayName);
    await setSessionCookie(result.roomId, result.token);

    return Response.json(
      { roomId: result.roomId, code: result.code, playerId: result.playerId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
