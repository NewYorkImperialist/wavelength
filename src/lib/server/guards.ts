import "server-only";

import { ApiError } from "./errors";
import type { Actor } from "./session";

/**
 * Authorization for round actions.
 *
 * The service-role client bypasses RLS entirely, so these are the real access
 * controls. Every mutating route calls the guards it needs before touching a
 * row, and the row update itself is additionally conditioned on the phase, so
 * two racing requests cannot both win.
 */

export type DbPhase = "clue" | "guess" | "prediction" | "reveal" | "complete";
export type DbTeam = "a" | "b";

export interface RoundRow {
  readonly id: string;
  readonly room_id: string;
  readonly game_id: string;
  readonly phase: DbPhase;
  readonly active_team: DbTeam;
  readonly psychic_player_id: string;
  readonly needle_controller_id: string | null;
}

export const otherTeam = (team: DbTeam): DbTeam => (team === "a" ? "b" : "a");

export function assertPhase(round: RoundRow, ...allowed: DbPhase[]): void {
  if (!allowed.includes(round.phase)) {
    throw new ApiError(
      "CONFLICT",
      `That is not possible right now (round is at "${round.phase}").`,
    );
  }
}

export function assertPsychic(round: RoundRow, actor: Actor): void {
  if (round.psychic_player_id !== actor.playerId) {
    // Deliberately the same shape as any other refusal: the response must not
    // hint at whether the caller is close to being entitled to the target.
    throw new ApiError("FORBIDDEN", "Only the Psychic can do that.");
  }
}

export function assertActiveTeam(round: RoundRow, actor: Actor): void {
  if (actor.team !== round.active_team) {
    throw new ApiError("FORBIDDEN", "Only the guessing team can do that.");
  }
}

export function assertOpposingTeam(round: RoundRow, actor: Actor): void {
  if (actor.team !== otherTeam(round.active_team)) {
    throw new ApiError("FORBIDDEN", "Only the opposing team can call left or right.");
  }
}

export function assertNotPsychic(round: RoundRow, actor: Actor): void {
  if (round.psychic_player_id === actor.playerId) {
    throw new ApiError("FORBIDDEN", "The Psychic cannot move the needle.");
  }
}

export function assertController(round: RoundRow, actor: Actor): void {
  if (round.needle_controller_id !== actor.playerId) {
    throw new ApiError("FORBIDDEN", "Someone else is holding the dial.");
  }
}

export function assertHost(actor: Actor): void {
  if (!actor.isHost) {
    throw new ApiError("FORBIDDEN", "Only the host can do that.");
  }
}
