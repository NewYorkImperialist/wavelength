import "server-only";

import { serverEnv } from "./env";

/**
 * Tell a room that something changed.
 *
 * The payload is deliberately empty. Clients react by re-fetching the
 * bootstrap endpoint, which is the one place that decides what a given player
 * is allowed to see. A notification that carries no data cannot leak anything,
 * and there is no second serialisation path to audit.
 *
 * This replaces `postgres_changes` subscriptions. Those require the browser to
 * hold a token whose claims satisfy the RLS policies, which means minting and
 * refreshing custom JWTs signed with the project's JWT secret. Broadcast needs
 * none of that — and since the client never reads Supabase directly anyway,
 * the extra machinery bought nothing.
 */

export const roomTopic = (roomId: string): string => `room:${roomId}`;

/**
 * Fire-and-forget: a failed notification must never fail the mutation that
 * triggered it. The worst case is that clients notice via polling instead.
 */
export function notifyRoom(roomId: string, reason: string): void {
  void sendBroadcast(roomId, reason).catch((error: unknown) => {
    console.warn("[wavelength] room notification failed", { roomId, reason, error });
  });
}

async function sendBroadcast(roomId: string, reason: string): Promise<void> {
  const response = await fetch(`${serverEnv.supabaseUrl}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serverEnv.serviceRoleKey,
      Authorization: `Bearer ${serverEnv.serviceRoleKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: roomTopic(roomId),
          event: "changed",
          // `reason` is a coarse label for debugging — never game data.
          payload: { reason },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`broadcast ${response.status}: ${await response.text()}`);
  }
}
