import { randomBytes } from "node:crypto";

import { disconnectPlayer, notifyRoom } from "@/lib/server/broadcast";
import { commitToTarget, generateTargetSteps } from "@/lib/server/createRound";
import { nowIso, one, run, transaction } from "@/lib/server/db";
import { handleRoute } from "@/lib/server/errors";
import { requireActor } from "@/lib/server/session";
import { reconsiderSkipVotes } from "@/lib/server/skipVote";

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
 *
 * A departure also changes the arithmetic of a skip vote, so that is
 * re-checked here rather than waiting for someone to press something.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);

    transaction(() => {
      run("update players set left_at = ?, is_host = 0 where id = ?", nowIso(), actor.playerId);

      if (actor.isHost) reassignHost(roomId, actor.playerId);
      reassignPsychicIfNeeded(roomId, actor.playerId);

      // After the handover, not before: a replacement Psychic re-rolls the
      // target, and the skip has to be judged against whoever is holding the
      // card now.
      reconsiderSkipVotes(roomId);
    });

    disconnectPlayer(roomId, actor.playerId);
    notifyRoom(roomId, "player-left");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Longest-standing remaining player takes over. */
function reassignHost(roomId: string, leavingId: string): void {
  const next = one<{ id: string }>(
    `select id from players
      where room_id = ? and left_at is null and id <> ?
      order by created_at, rowid limit 1`,
    roomId,
    leavingId,
  );
  if (next === null) return; // Empty room; nothing to hand over.

  run("update players set is_host = 1 where id = ?", next.id);
  run("update rooms set host_player_id = ? where id = ?", next.id, roomId);
}

/**
 * If the Psychic walks out before giving their clue, hand the role to a
 * teammate and re-roll the target — the departing player saw the old one, and
 * might still be in the room.
 *
 * After the clue is given it is too late: the clue belongs to that target, so
 * the round simply continues without them.
 */
function reassignPsychicIfNeeded(roomId: string, leavingId: string): void {
  const round = one<{ id: string; active_team: "a" | "b" }>(
    `select id, active_team from rounds
      where room_id = ? and phase = 'clue' and psychic_player_id = ?`,
    roomId,
    leavingId,
  );
  if (round === null) return;

  const replacement = one<{ id: string }>(
    `select id from players
      where room_id = ? and team = ? and left_at is null
      order by seat_order limit 1`,
    roomId,
    round.active_team,
  );
  if (replacement === null) return; // Team is empty; the host must intervene.

  const targetSteps = generateTargetSteps();
  const nonce = randomBytes(16);
  const { commitment } = commitToTarget(targetSteps, nonce);

  run(
    `update round_targets set target_center = ?, nonce = ? where round_id = ?`,
    targetSteps,
    nonce,
    round.id,
  );
  run(
    `update rounds set psychic_player_id = ?, needle_controller_id = null,
                       target_commitment = ?
      where id = ? and phase = 'clue'`,
    replacement.id,
    commitment,
    round.id,
  );
}
