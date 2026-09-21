import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { POSITION_STEPS, TARGET_HALF_STEPS } from "../constants";
import { scoreFreeForAllRound } from "../free-for-all";
import { scoreNeedle } from "../scoring";

const step = (n: number) => n / POSITION_STEPS;
const CENTRE = 0.5;

/** Positions that land squarely in each band, for readable tests. */
const hits = {
  four: CENTRE,
  three: CENTRE + step(TARGET_HALF_STEPS.four + 10),
  two: CENTRE + step(TARGET_HALF_STEPS.three + 10),
  miss: CENTRE + step(TARGET_HALF_STEPS.two + 100),
};

describe("free-for-all scoring", () => {
  it("scores each guesser on their own needle", () => {
    const awards = scoreFreeForAllRound(CENTRE, "psychic", [
      { playerId: "bo", position: hits.four },
      { playerId: "cy", position: hits.three },
      { playerId: "di", position: hits.miss },
    ]);

    const points = Object.fromEntries(awards.map((a) => [a.playerId, a.points]));
    expect(points.bo).toBe(4);
    expect(points.cy).toBe(3);
    expect(points.di).toBe(0);
  });

  it("gives the Psychic the average, rounded", () => {
    // 4 + 3 + 0 = 7 over three players = 2.33 -> 2
    const awards = scoreFreeForAllRound(CENTRE, "ada", [
      { playerId: "bo", position: hits.four },
      { playerId: "cy", position: hits.three },
      { playerId: "di", position: hits.miss },
    ]);
    const psychic = awards.find((a) => a.isPsychic);
    expect(psychic?.points).toBe(2);
    expect(psychic?.position).toBeNull();
  });

  it("rewards a clue that lands everyone on the target", () => {
    const awards = scoreFreeForAllRound(CENTRE, "ada", [
      { playerId: "bo", position: hits.four },
      { playerId: "cy", position: hits.four },
    ]);
    expect(awards.find((a) => a.isPsychic)?.points).toBe(4);
  });

  it("punishes a clue nobody can read", () => {
    const awards = scoreFreeForAllRound(CENTRE, "ada", [
      { playerId: "bo", position: hits.miss },
      { playerId: "cy", position: hits.miss },
    ]);
    expect(awards.find((a) => a.isPsychic)?.points).toBe(0);
  });

  it("ignores a needle the Psychic somehow submitted", () => {
    const awards = scoreFreeForAllRound(CENTRE, "ada", [
      { playerId: "ada", position: hits.four },
      { playerId: "bo", position: hits.miss },
    ]);
    expect(awards).toHaveLength(2);
    expect(awards.find((a) => a.playerId === "ada")?.points).toBe(0);
  });

  it("scores the Psychic nothing when nobody guessed", () => {
    const awards = scoreFreeForAllRound(CENTRE, "ada", []);
    expect(awards).toEqual([
      { playerId: "ada", points: 0, position: null, isPsychic: true },
    ]);
  });

  it("awards everyone exactly once", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.25, max: 0.75, noNaN: true }),
        fc.uniqueArray(fc.constantFrom("bo", "cy", "di", "eve"), { minLength: 1 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (target, ids, position) => {
          const awards = scoreFreeForAllRound(
            target,
            "ada",
            ids.map((playerId) => ({ playerId, position })),
          );
          expect(awards).toHaveLength(ids.length + 1);
          expect(new Set(awards.map((a) => a.playerId)).size).toBe(ids.length + 1);
          for (const award of awards) {
            expect(award.points).toBeGreaterThanOrEqual(0);
            expect(award.points).toBeLessThanOrEqual(4);
          }
        },
      ),
    );
  });

  it("agrees with the one authoritative scorer", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.25, max: 0.75, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (target, position) => {
          const awards = scoreFreeForAllRound(target, "ada", [
            { playerId: "bo", position },
          ]);
          const bo = awards.find((a) => a.playerId === "bo");
          expect(bo?.points).toBe(scoreNeedle(target, position));
        },
      ),
    );
  });
});

describe("the widened target", () => {
  it("spans a quarter of the dial in five equal bands", () => {
    expect(TARGET_HALF_STEPS.two * 2).toBe(POSITION_STEPS / 4);
    expect(TARGET_HALF_STEPS.four * 2).toBe(100); // 5%
    expect(TARGET_HALF_STEPS.three - TARGET_HALF_STEPS.four).toBe(100);
    expect(TARGET_HALF_STEPS.two - TARGET_HALF_STEPS.three).toBe(100);
  });

  it("makes a reasonable guess score something", () => {
    // 2% out used to be a 3; it is now a bullseye.
    expect(scoreNeedle(0.5, 0.52)).toBe(4);
    // A tenth of the dial out still scores, where it used to be nothing.
    expect(scoreNeedle(0.5, 0.6)).toBe(2);
    // Only a genuinely wrong answer scores zero.
    expect(scoreNeedle(0.5, 0.9)).toBe(0);
  });
});
