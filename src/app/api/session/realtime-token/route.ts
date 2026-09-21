import { SignJWT } from "jose";

import { serverEnv } from "@/lib/server/env";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fifteen minutes: long enough not to churn, short enough to bound misuse. */
const TTL_SECONDS = 15 * 60;

/**
 * Exchange the httpOnly session cookie for a short-lived, room-scoped JWT the
 * browser can use to read from Supabase directly.
 *
 * Players are anonymous — there is no auth.users row — but PostgREST and
 * Realtime accept any token signed with the project's JWT secret, and the
 * `room_id` claim is what the RLS policies read. That is what confines a
 * client's reads to its own room without proxying every query.
 *
 * The token is returned in the body rather than a cookie because the Supabase
 * client has to attach it as an Authorization header. It is held in memory
 * only, never in localStorage, and it grants nothing but scoped reads: the
 * browser has no write grant anywhere.
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (roomId === null || roomId === "") {
      throw new ApiError("BAD_REQUEST", "A room is required.");
    }

    const actor = await requireActor(roomId);
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    const token = await new SignJWT({
      room_id: actor.roomId,
      player_id: actor.playerId,
      role: "authenticated",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(actor.playerId)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(serverEnv.jwtSecret));

    return Response.json(
      { token, expiresAt: expiresAt * 1000 },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  });
}
