import "server-only";

import { POSITION_STEPS, WINNING_SCORE } from "@/lib/game/constants";
import { scoreNeedle, scoreOpponentPrediction } from "@/lib/game/scoring";
import type { Side } from "@/lib/game/types";

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
  /** Null in co-op: there is no opposing team to call left or right. */
  readonly prediction: Side | null;
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
 * and how sudden death advances.
 *
 * Only the tests reach this now. It is the scoring for the original team
 * game, kept because its rules are pinned down by those tests and the team
 * mode may return; the free-for-all reveal lives in `freeForAll.ts`.
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
