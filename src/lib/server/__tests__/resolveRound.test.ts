/**
 * The server's scoring path must agree with the engine exactly — that is the
 * whole point of having one scoring module. These tests run the server's
 * resolver against the same scenarios the state machine is tested with.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { POSITION_STEPS, TARGET_HALF_STEPS, WINNING_SCORE } from "@/lib/game/constants";
import { scoreNeedle, scoreOpponentPrediction } from "@/lib/game/scoring";
import { resolveScores } from "../resolveRound";

const freshGame = {
  score_a: 0,
  score_b: 0,
  sudden_death_index: 0,
  sudden_death_turns: 0,
  sudden_death_pts_a: 0,
  sudden_death_pts_b: 0,
};

const CENTRE = POSITION_STEPS / 2;

describe("scoring agrees with the engine", () => {
  it("matches scoreNeedle and scoreOpponentPrediction for random inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 125, max: 1875 }),
        fc.integer({ min: 0, max: POSITION_STEPS }),
        fc.constantFrom("left" as const, "right" as const),
        fc.constantFrom("a" as const, "b" as const),
        (targetSteps, needleSteps, prediction, activeTeam) => {
          const outcome = resolveScores(
            { targetSteps, needleSteps, prediction, activeTeam },
            freshGame,
          );
          const target = targetSteps / POSITION_STEPS;
          const needle = needleSteps / POSITION_STEPS;

          expect(outcome.activePoints).toBe(scoreNeedle(target, needle));
          expect(outcome.opponentPoints).toBe(
            scoreOpponentPrediction(target, needle, prediction),
          );
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("awards points to the right teams", () => {
    const outcome = resolveScores(
      {
        targetSteps: CENTRE + TARGET_HALF_STEPS.two,
        needleSteps: CENTRE,
        prediction: "right",
        activeTeam: "a",
      },
      freshGame,
    );
    expect(outcome.activePoints).toBe(2);
    expect(outcome.opponentPoints).toBe(1);
    expect(outcome.scoreA).toBe(2);
    expect(outcome.scoreB).toBe(1);
  });

  it("blocks the bonus on a bullseye", () => {
    const outcome = resolveScores(
      { targetSteps: CENTRE + 10, needleSteps: CENTRE, prediction: "right", activeTeam: "a" },
      freshGame,
    );
    expect(outcome.activePoints).toBe(4);
    expect(outcome.opponentPoints).toBe(0);
  });
});

describe("victory", () => {
  it("ends the game when the active team crosses the line ahead", () => {
    const outcome = resolveScores(
      { targetSteps: CENTRE, needleSteps: CENTRE, prediction: "left", activeTeam: "a" },
      { ...freshGame, score_a: WINNING_SCORE - 4, score_b: 3 },
    );
    expect(outcome.scoreA).toBe(WINNING_SCORE);
    expect(outcome.winner).toBe("a");
  });

  it("lets the opposing team win on the active team's turn via the bonus", () => {
    const outcome = resolveScores(
      {
        targetSteps: POSITION_STEPS - 200,
        needleSteps: CENTRE,
        prediction: "right",
        activeTeam: "a",
      },
      { ...freshGame, score_a: 5, score_b: WINNING_SCORE - 1 },
    );
    expect(outcome.activePoints).toBe(0);
    expect(outcome.opponentPoints).toBe(1);
    expect(outcome.scoreB).toBe(WINNING_SCORE);
    expect(outcome.winner).toBe("b");
  });

  it("does not end the game early", () => {
    const outcome = resolveScores(
      { targetSteps: CENTRE, needleSteps: CENTRE, prediction: "left", activeTeam: "a" },
      { ...freshGame, score_a: 2, score_b: 2 },
    );
    expect(outcome.winner).toBeNull();
    expect(outcome.suddenDeath.index).toBe(0);
  });
});

describe("sudden death", () => {
  it("starts when both teams finish level at or above the line", () => {
    const outcome = resolveScores(
      {
        targetSteps: CENTRE + TARGET_HALF_STEPS.two,
        needleSteps: CENTRE,
        prediction: "left",
        activeTeam: "a",
      },
      { ...freshGame, score_a: WINNING_SCORE - 2, score_b: WINNING_SCORE },
    );
    expect(outcome.scoreA).toBe(WINNING_SCORE);
    expect(outcome.scoreB).toBe(WINNING_SCORE);
    expect(outcome.winner).toBeNull();
    expect(outcome.suddenDeath).toEqual({ index: 1, turns: 0, pointsA: 0, pointsB: 0 });
  });

  it("takes one turn from each team, then awards the round", () => {
    const first = resolveScores(
      {
        targetSteps: CENTRE + TARGET_HALF_STEPS.two,
        needleSteps: CENTRE,
        prediction: "left",
        activeTeam: "b",
      },
      { ...freshGame, score_a: 10, score_b: 10, sudden_death_index: 1 },
    );
    expect(first.suddenDeath.turns).toBe(1);
    expect(first.suddenDeath.pointsB).toBe(2);
    expect(first.winner).toBeNull();

    const second = resolveScores(
      { targetSteps: CENTRE, needleSteps: CENTRE, prediction: "left", activeTeam: "a" },
      {
        score_a: first.scoreA,
        score_b: first.scoreB,
        sudden_death_index: first.suddenDeath.index,
        sudden_death_turns: first.suddenDeath.turns,
        sudden_death_pts_a: first.suddenDeath.pointsA,
        sudden_death_pts_b: first.suddenDeath.pointsB,
      },
    );
    expect(second.suddenDeath.pointsA).toBe(4);
    expect(second.winner).toBe("a");
  });

  it("goes round again when the sudden-death round is itself tied", () => {
    const tied = resolveScores(
      {
        targetSteps: CENTRE + TARGET_HALF_STEPS.two,
        needleSteps: CENTRE,
        prediction: "left",
        activeTeam: "a",
      },
      {
        score_a: 12,
        score_b: 12,
        sudden_death_index: 1,
        sudden_death_turns: 1,
        sudden_death_pts_a: 0,
        sudden_death_pts_b: 2,
      },
    );
    expect(tied.suddenDeath).toEqual({ index: 2, turns: 0, pointsA: 0, pointsB: 0 });
    expect(tied.winner).toBeNull();
  });

  it("counts the opposing team's bonus toward the tiebreak", () => {
    const outcome = resolveScores(
      {
        targetSteps: CENTRE + TARGET_HALF_STEPS.two,
        needleSteps: CENTRE,
        prediction: "right",
        activeTeam: "b",
      },
      { ...freshGame, score_a: 10, score_b: 10, sudden_death_index: 1 },
    );
    expect(outcome.suddenDeath.pointsB).toBe(2);
    expect(outcome.suddenDeath.pointsA).toBe(1);
  });

  it("keeps the running totals climbing during sudden death", () => {
    const outcome = resolveScores(
      { targetSteps: CENTRE, needleSteps: CENTRE, prediction: "left", activeTeam: "a" },
      { ...freshGame, score_a: 11, score_b: 11, sudden_death_index: 2 },
    );
    expect(outcome.scoreA).toBe(15);
  });
});
