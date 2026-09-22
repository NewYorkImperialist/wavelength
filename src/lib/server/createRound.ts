import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";

import { POSITION_STEPS, TARGET_HALF_STEPS } from "@/lib/game/constants";

import { serviceClient } from "./db";
import { ApiError } from "./errors";
import type { DbTeam } from "./guards";

/**
 * Round creation: the only place a target is generated, and the boundary the
 * whole security model is built around.
 *
 * The target is written to `private.round_targets`. The public `rounds` row
 * gets only a commitment to it, so Realtime has nothing to leak.
 */

/** Steps at which the whole 2/3/4/3/2 band still fits on the dial. */
const MIN_CENTER_STEPS = TARGET_HALF_STEPS.two;
const MAX_CENTER_STEPS = POSITION_STEPS - TARGET_HALF_STEPS.two;

/**
 * sha256(nonce || target). A 16-byte random nonce makes this infeasible to
 * brute-force even though the target has only ~1750 possible values, so
 * publishing it leaks nothing — but it lets a client prove afterwards that the
 * server did not move the target once it had seen the needle.
 */
export function commitToTarget(
  targetSteps: number,
  nonce: Buffer,
): { commitment: Buffer } {
  const commitment = createHash("sha256")
    .update(nonce)
    .update(String(targetSteps))
    .digest();
  return { commitment };
}

/**
 * `randomInt` is a CSPRNG, unlike `Math.random`. The target must not be
 * predictable from a seed, a timestamp, or the round's own id.
 */
export function generateTargetSteps(): number {
  return randomInt(MIN_CENTER_STEPS, MAX_CENTER_STEPS + 1);
}

interface SeatRow {
  id: string;
  seat_order: number;
}

/**
 * Next psychic for a team: the seat after whoever went last, wrapping around,
 * skipping nobody — a player who has left keeps their seat so the rotation is
 * undisturbed if they return, matching the local engine's behaviour.
 */
export async function pickPsychic(
  roomId: string,
  gameId: string,
  team: DbTeam,
): Promise<{ psychicId: string; controllerId: string }> {
  const db = serviceClient();

  const { data: seats, error } = await db
    .from("players")
    .select("id, seat_order")
    .eq("room_id", roomId)
    .eq("team", team)
    .is("left_at", null)
    .order("seat_order", { ascending: true })
    .returns<SeatRow[]>();

  if (error !== null) throw new ApiError("SERVER_ERROR", "Could not read the roster.");
  if (seats === null || seats.length === 0) {
    throw new ApiError("CONFLICT", "That team has no connected players.");
  }

  const { data: previous } = await db
    .from("rounds")
    .select("psychic_player_id")
    .eq("game_id", gameId)
    .eq("active_team", team)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ psychic_player_id: string }>();

  const lastIndex =
    previous === null
      ? -1
      : seats.findIndex((seat) => seat.id === previous.psychic_player_id);

  const psychic = seats[(lastIndex + 1) % seats.length];
  if (psychic === undefined) {
    throw new ApiError("SERVER_ERROR", "Could not choose a Psychic.");
  }

  // The dial goes to someone other than the Psychic where possible; on a team
  // that has shrunk to one, it falls back to them.
  const controller =
    seats.length === 1
      ? psychic
      : (seats[(lastIndex + 2) % seats.length] ?? psychic);

  return { psychicId: psychic.id, controllerId: controller.id };
}

/**
 * Draw a card that has not been played this game.
 *
 * `banned` is excluded even from the reshuffle, unlike the used list. It
 * carries the card a vote-skip just rejected: on a small deck the reshuffle
 * would otherwise be free to deal straight back the card the room had only
 * just voted out.
 */
export async function pickCard(
  gameId: string,
  banned: readonly string[] = [],
): Promise<string> {
  const db = serviceClient();

  const { data: used } = await db
    .from("game_used_cards")
    .select("card_id")
    .eq("game_id", gameId)
    .returns<{ card_id: string }[]>();

  const quoted = (ids: readonly string[]): string =>
    `(${ids.map((id) => `"${id}"`).join(",")})`;
  const usedIds = [...new Set([...(used ?? []).map((row) => row.card_id), ...banned])];

  let query = db.from("spectrum_cards").select("id").eq("enabled", true);
  if (usedIds.length > 0) {
    query = query.not("id", "in", quoted(usedIds));
  }

  const { data: available, error } = await query.returns<{ id: string }[]>();
  if (error !== null) throw new ApiError("SERVER_ERROR", "Could not read the deck.");

  // Exhausted decks reshuffle rather than ending the game for a reason that
  // has nothing to do with the rules.
  let fallback = db.from("spectrum_cards").select("id").eq("enabled", true);
  if (banned.length > 0) {
    fallback = fallback.not("id", "in", quoted(banned));
  }

  const pool =
    available !== null && available.length > 0
      ? available
      : ((await fallback.returns<{ id: string }[]>()).data ?? []);

  const chosen = pool[randomInt(0, Math.max(1, pool.length))];
  if (chosen === undefined) throw new ApiError("SERVER_ERROR", "The deck is empty.");
  return chosen.id;
}

export interface CreateRoundArgs {
  readonly roomId: string;
  readonly gameId: string;
  readonly roundNumber: number;
  readonly activeTeam: DbTeam;
}

export async function createRound(args: CreateRoundArgs): Promise<{ roundId: string }> {
  const db = serviceClient();

  const { psychicId, controllerId } = await pickPsychic(
    args.roomId,
    args.gameId,
    args.activeTeam,
  );
  const cardId = await pickCard(args.gameId);

  const targetSteps = generateTargetSteps();
  const nonce = randomBytes(16);
  const { commitment } = commitToTarget(targetSteps, nonce);

  const { data: round, error } = await db
    .from("rounds")
    .insert({
      game_id: args.gameId,
      room_id: args.roomId,
      round_number: args.roundNumber,
      active_team: args.activeTeam,
      psychic_player_id: psychicId,
      needle_controller_id: controllerId,
      card_id: cardId,
      phase: "clue",
      target_commitment: `\\x${commitment.toString("hex")}`,
    })
    .select("id")
    .single<{ id: string }>();

  if (error !== null || round === null) {
    throw new ApiError("SERVER_ERROR", "Could not start the round.");
  }

  // The secret, written through a SECURITY DEFINER function because the
  // `private` schema is not exposed to PostgREST — not even for service_role.
  const { error: targetError } = await db.rpc("place_round_target", {
    p_round_id: round.id,
    p_target: targetSteps,
    p_nonce: `\\x${nonce.toString("hex")}`,
  });
  if (targetError !== null) {
    // Without a target the round is unplayable; don't leave it half-created.
    await db.from("rounds").delete().eq("id", round.id);
    throw new ApiError("SERVER_ERROR", "Could not place the target.");
  }

  await db.from("game_used_cards").insert({ game_id: args.gameId, card_id: cardId });
  await db.from("games").update({ current_round_id: round.id }).eq("id", args.gameId);

  return { roundId: round.id };
}
