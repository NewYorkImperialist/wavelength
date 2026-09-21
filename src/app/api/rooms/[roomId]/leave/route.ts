import { randomBytes } from "node:crypto";

import { notifyRoom } from "@/lib/server/broadcast";
import { commitToTarget, generateTargetSteps } from "@/lib/server/createRound";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leave a room.
 *
 * The player is marked as gone rather than deleted: rounds reference them as
 * Psychic, and history should keep naming them. Their seat stays in the
 * rotation too, so returning does not disturb the cycle.
 *
 * Two things must be handed on before they go, or the room can strand:
 * the host badge (nobody else can start or restart) and the Psychic role
 * (the round waits forever for a clue that is not coming).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);
    const db = serviceClient();

    const { error } = await db
      .from("players")
      .update({ left_at: new Date().toISOString(), is_host: false })
      .eq("id", actor.playerId);
    if (error !== null) throw new ApiError("SERVER_ERROR", "Could not leave the room.");

    if (actor.isHost) await reassignHost(roomId, actor.playerId);
    await reassignPsychicIfNeeded(roomId, actor.playerId);

    notifyRoom(roomId, "player-left");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Longest-standing remaining player takes over. */
async function reassignHost(roomId: string, leavingId: string): Promise<void> {
  const db = serviceClient();
  const { data: next } = await db
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .neq("id", leavingId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (next === null) return; // Empty room; nothing to hand over.
  await db.from("players").update({ is_host: true }).eq("id", next.id);
  await db.from("rooms").update({ host_player_id: next.id }).eq("id", roomId);
}

/**
 * If the Psychic walks out before giving their clue, hand the role to a
 * teammate and re-roll the target — the departing player saw the old one, and
 * might still be in the room.
 *
 * After the clue is given it is too late: the clue belongs to that target, so
 * the round simply continues without them.
 */
async function reassignPsychicIfNeeded(roomId: string, leavingId: string): Promise<void> {
  const db = serviceClient();

  const { data: round } = await db
    .from("rounds")
    .select("id, game_id, active_team, psychic_player_id, phase")
    .eq("room_id", roomId)
    .eq("phase", "clue")
    .eq("psychic_player_id", leavingId)
    .maybeSingle<{
      id: string;
      game_id: string;
      active_team: "a" | "b";
      psychic_player_id: string;
      phase: string;
    }>();

  if (round === null) return;

  const { data: replacement } = await db
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .eq("team", round.active_team)
    .is("left_at", null)
    .order("seat_order", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (replacement === null) return; // Team is empty; the host must intervene.

  const targetSteps = generateTargetSteps();
  const nonce = randomBytes(16);
  const { commitment } = commitToTarget(targetSteps, nonce);

  await db.rpc("replace_round_target", {
    p_round_id: round.id,
    p_target: targetSteps,
    p_nonce: `\\x${nonce.toString("hex")}`,
  });

  await db
    .from("rounds")
    .update({
      psychic_player_id: replacement.id,
      needle_controller_id: null,
      target_commitment: `\\x${commitment.toString("hex")}`,
    })
    .eq("id", round.id)
    .eq("phase", "clue");
}
