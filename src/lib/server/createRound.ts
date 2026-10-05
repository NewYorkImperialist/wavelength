import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";

import { POSITION_STEPS, TARGET_HALF_STEPS } from "@/lib/game/constants";

import { all, newId, one, run, transaction } from "./db";
import { ApiError } from "./errors";
import type { DbTeam } from "./guards";

/**
 * Round creation: the only place a target is generated, and the boundary the
 * whole security model is built around.
 *
 * The target is written to `round_targets`. The `rounds` row gets only a
 * commitment to it, so no query of rounds can carry the secret.
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
export function pickPsychic(
  roomId: string,
  gameId: string,
  team: DbTeam,
): { psychicId: string; controllerId: string } {
  const seats = all<SeatRow>(
    `select id, seat_order from players
      where room_id = ? and team = ? and left_at is null
      order by seat_order`,
    roomId,
    team,
  );
  if (seats.length === 0) {
    throw new ApiError("CONFLICT", "That team has no connected players.");
  }

  const previous = one<{ psychic_player_id: string }>(
    `select psychic_player_id from rounds
      where game_id = ? and active_team = ?
      order by round_number desc limit 1`,
    gameId,
    team,
  );

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
export function pickCard(gameId: string, banned: readonly string[] = []): string {
  const enabled = all<{ id: string }>("select id from spectrum_cards where enabled = 1").map(
    (card) => card.id,
  );
  const used = new Set([
    ...all<{ card_id: string }>(
      "select card_id from game_used_cards where game_id = ?",
      gameId,
    ).map((row) => row.card_id),
    ...banned,
  ]);

  const available = enabled.filter((id) => !used.has(id));
  // Exhausted decks reshuffle rather than ending the game for a reason that
  // has nothing to do with the rules.
  const pool = available.length > 0 ? available : enabled.filter((id) => !banned.includes(id));

  const chosen = pool[randomInt(0, Math.max(1, pool.length))];
  if (chosen === undefined) throw new ApiError("SERVER_ERROR", "The deck is empty.");
  return chosen;
}

export interface CreateRoundArgs {
  readonly roomId: string;
  readonly gameId: string;
  readonly roundNumber: number;
  readonly activeTeam: DbTeam;
}

/** Call inside the caller's transaction, so a failed round leaves no trace. */
export function createRound(args: CreateRoundArgs): { roundId: string } {
  return transaction(() => {
    const { psychicId, controllerId } = pickPsychic(args.roomId, args.gameId, args.activeTeam);
    const cardId = pickCard(args.gameId);

    const targetSteps = generateTargetSteps();
    const nonce = randomBytes(16);
    const { commitment } = commitToTarget(targetSteps, nonce);

    const roundId = newId();
    run(
      `insert into rounds (id, game_id, room_id, round_number, active_team,
                           psychic_player_id, needle_controller_id, card_id,
                           phase, target_commitment)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'clue', ?)`,
      roundId,
      args.gameId,
      args.roomId,
      args.roundNumber,
      args.activeTeam,
      psychicId,
      controllerId,
      cardId,
      commitment,
    );
    run(
      "insert into round_targets (round_id, target_center, nonce) values (?, ?, ?)",
      roundId,
      targetSteps,
      nonce,
    );
    run("insert into game_used_cards (game_id, card_id) values (?, ?)", args.gameId, cardId);
    run("update games set current_round_id = ? where id = ?", roundId, args.gameId);

    return { roundId };
  });
}
