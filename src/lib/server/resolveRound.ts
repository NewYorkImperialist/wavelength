import "server-only";

import { POSITION_STEPS, WINNING_SCORE } from "@/lib/game/constants";
import { scoreNeedle, scoreOpponentPrediction } from "@/lib/game/scoring";
import type { Side } from "@/lib/game/types";

import { serviceClient } from "./db";
import { ApiError } from "./errors";
import { otherTeam, type DbTeam } from "./guards";

/**
 * Reveal and scoring.
 *
 * The scores written here are the scores of record, and they come from
 * `@/lib/game/scoring` — the same module the browser imports to draw the
 * result. There is exactly one implementation of the rules; the client never
 * computes a score that is stored or trusted.
 */

export interface GameRow {
  readonly id: string;
  readonly score_a: number;
  readonly score_b: number;
  readonly sudden_death_index: number;
  readonly sudden_death_turns: number;
  readonly sudden_death_pts_a: number;
  readonly sudden_death_pts_b: number;
}

export interface ResolveInput {
  readonly roundId: string;
  readonly gameId: string;
  readonly activeTeam: DbTeam;
  readonly needleSteps: number;
  readonly prediction: Side;
  readonly winningScore?: number;
}

export interface ResolveOutcome {
  readonly targetSteps: number;
  readonly activePoints: 0 | 2 | 3 | 4;
  readonly opponentPoints: 0 | 1;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly winner: DbTeam | null;
  readonly suddenDeath: {
    readonly index: number;
    readonly turns: number;
    readonly pointsA: number;
    readonly pointsB: number;
  };
}

/**
 * Pure given the inputs: works out the new scores, whether the game is over,
 * and how sudden death advances. Exported separately from the database work so
 * it can be tested without one.
 */
export function resolveScores(
  input: Omit<ResolveInput, "roundId" | "gameId"> & { targetSteps: number },
  game: Pick<
    GameRow,
    "score_a" | "score_b" | "sudden_death_index" | "sudden_death_turns" | "sudden_death_pts_a" | "sudden_death_pts_b"
  >,
): ResolveOutcome {
  const target = input.targetSteps / POSITION_STEPS;
  const needle = input.needleSteps / POSITION_STEPS;
  const winningScore = input.winningScore ?? WINNING_SCORE;

  const activePoints = scoreNeedle(target, needle);
  const opponentPoints = scoreOpponentPrediction(target, needle, input.prediction);

  const opposing = otherTeam(input.activeTeam);
  const scores: Record<DbTeam, number> = { a: game.score_a, b: game.score_b };
  scores[input.activeTeam] += activePoints;
  scores[opposing] += opponentPoints;

  let index = game.sudden_death_index;
  let turns = game.sudden_death_turns;
  const roundPoints: Record<DbTeam, number> = {
    a: game.sudden_death_pts_a,
    b: game.sudden_death_pts_b,
  };
  let winner: DbTeam | null = null;

  if (index > 0) {
    roundPoints[input.activeTeam] += activePoints;
    roundPoints[opposing] += opponentPoints;
    turns += 1;

    if (turns >= 2) {
      if (roundPoints.a !== roundPoints.b) {
        winner = roundPoints.a > roundPoints.b ? "a" : "b";
      } else {
        // Still level: go again.
        index += 1;
        turns = 0;
        roundPoints.a = 0;
        roundPoints.b = 0;
      }
    }
  } else if (scores.a >= winningScore || scores.b >= winningScore) {
    // Both awards are already applied, so the opposing team can cross the line
    // — and win — on the active team's turn.
    if (scores.a !== scores.b) {
      winner = scores.a > scores.b ? "a" : "b";
    } else {
      index = 1;
      turns = 0;
      roundPoints.a = 0;
      roundPoints.b = 0;
    }
  }

  return {
    targetSteps: input.targetSteps,
    activePoints,
    opponentPoints,
    scoreA: scores.a,
    scoreB: scores.b,
    winner,
    suddenDeath: { index, turns, pointsA: roundPoints.a, pointsB: roundPoints.b },
  };
}

/**
 * Read the secret, score it, and publish the result.
 *
 * The prediction write and the reveal are one step deliberately: making reveal
 * a separate client-triggered call would leave a window in which the
 * prediction is locked but the target is still hidden, and some client would
 * have to decide to close it.
 */
export async function revealAndScore(input: ResolveInput): Promise<ResolveOutcome> {
  const db = serviceClient();

  // `take_round_target` is a set-returning function, so it comes back as rows.
  const { data: targetData, error: targetError } = await db.rpc("take_round_target", {
    p_round_id: input.roundId,
  });

  if (targetError !== null) throw new ApiError("SERVER_ERROR", "Could not read the target.");
  const targetRows = targetData as { target_center: number; nonce: string }[] | null;
  const target = targetRows?.[0];
  if (target === undefined) throw new ApiError("NOT_FOUND", "No target for this round.");

  const { data: game, error: gameError } = await db
    .from("games")
    .select(
      "id, score_a, score_b, sudden_death_index, sudden_death_turns, sudden_death_pts_a, sudden_death_pts_b",
    )
    .eq("id", input.gameId)
    .maybeSingle<GameRow>();

  if (gameError !== null || game === null) {
    throw new ApiError("SERVER_ERROR", "Could not load the game.");
  }

  const outcome = resolveScores({ ...input, targetSteps: target.target_center }, game);

  // Conditional on the phase, so two racing reveals cannot both apply.
  const { data: updated, error: roundError } = await db
    .from("rounds")
    .update({
      phase: "reveal",
      revealed_target: outcome.targetSteps,
      active_points: outcome.activePoints,
      opponent_points: outcome.opponentPoints,
      revealed_at: new Date().toISOString(),
    })
    .eq("id", input.roundId)
    .eq("phase", "prediction")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (roundError !== null) throw new ApiError("SERVER_ERROR", "Could not reveal the round.");
  if (updated === null) throw new ApiError("CONFLICT", "This round was already revealed.");

  const { error: scoreError } = await db
    .from("games")
    .update({
      score_a: outcome.scoreA,
      score_b: outcome.scoreB,
      sudden_death_index: outcome.suddenDeath.index,
      sudden_death_turns: outcome.suddenDeath.turns,
      sudden_death_pts_a: outcome.suddenDeath.pointsA,
      sudden_death_pts_b: outcome.suddenDeath.pointsB,
      ...(outcome.winner === null
        ? {}
        : { winner: outcome.winner, status: "finished", ended_at: new Date().toISOString() }),
    })
    .eq("id", input.gameId);

  if (scoreError !== null) throw new ApiError("SERVER_ERROR", "Could not update the score.");

  return outcome;
}
