import "server-only";

import { POSITION_STEPS } from "@/lib/game/constants";
import type { Side } from "@/lib/game/types";

import type { DbPhase, DbTeam } from "./guards";

/**
 * Database rows are never handed to a client directly. Everything crossing the
 * boundary goes through an explicit allow-list mapper, so adding a column to a
 * table cannot silently start publishing it.
 */

export const stepsToPosition = (steps: number): number => steps / POSITION_STEPS;
export const positionToStepsDb = (position: number): number =>
  Math.round(Math.min(1, Math.max(0, position)) * POSITION_STEPS);

export const teamIdOf = (team: DbTeam): "teamA" | "teamB" =>
  team === "a" ? "teamA" : "teamB";

export interface PublicRoundDto {
  readonly id: string;
  readonly roundNumber: number;
  readonly activeTeam: "teamA" | "teamB";
  readonly psychicPlayerId: string;
  readonly phase: DbPhase;
  readonly card: { id: string; left: string; right: string };
  readonly clue: string | null;
  readonly needleControllerId: string | null;
  readonly needlePosition: number | null;
  readonly prediction: Side | null;
  readonly revealedTarget: number | null;
  readonly activePoints: number | null;
  readonly opponentPoints: number | null;
  readonly targetCommitment: string;
}

export interface RoundRowFull {
  readonly id: string;
  readonly round_number: number;
  readonly active_team: DbTeam;
  readonly psychic_player_id: string;
  readonly phase: DbPhase;
  readonly card_id: string;
  readonly clue: string | null;
  readonly needle_controller_id: string | null;
  readonly needle_position: number | null;
  readonly prediction: Side | null;
  readonly revealed_target: number | null;
  readonly active_points: number | null;
  readonly opponent_points: number | null;
  readonly target_commitment: string;
}

/**
 * Note what is NOT here: there is no branch that can emit the secret target.
 * `revealedTarget` comes from `rounds.revealed_target`, which the database
 * itself keeps NULL until the reveal transaction commits.
 */
export function toPublicRound(
  row: RoundRowFull,
  card: { id: string; left_label: string; right_label: string },
): PublicRoundDto {
  return {
    id: row.id,
    roundNumber: row.round_number,
    activeTeam: teamIdOf(row.active_team),
    psychicPlayerId: row.psychic_player_id,
    phase: row.phase,
    card: { id: card.id, left: card.left_label, right: card.right_label },
    clue: row.clue,
    needleControllerId: row.needle_controller_id,
    needlePosition:
      row.needle_position === null ? null : stepsToPosition(row.needle_position),
    prediction: row.prediction,
    revealedTarget:
      row.revealed_target === null ? null : stepsToPosition(row.revealed_target),
    activePoints: row.active_points,
    opponentPoints: row.opponent_points,
    targetCommitment: row.target_commitment,
  };
}
