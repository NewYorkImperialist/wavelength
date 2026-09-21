import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { POSITION_STEPS, TARGET_HALF_STEPS } from "../constants";
import { scoreNeedle, scoreOpponentPrediction, trueSide } from "../scoring";
import { TARGET_MAX_CENTER, TARGET_MIN_CENTER } from "../target";

const step = (n: number) => n / POSITION_STEPS;
const GRID: number[] = Array.from(
  { length: POSITION_STEPS + 1 },
  (_, i) => i / POSITION_STEPS,
);

describe("scoreNeedle", () => {
  it("scores a perfect guess 4 at every position on the dial", () => {
    for (const t of GRID) {
      expect(scoreNeedle(t, t)).toBe(4);
    }
  });

  // Bands are closed at their outer edge, so a needle exactly on a wedge line
  // scores the HIGHER value. These cases pin every boundary in the target.
  const boundaries: ReadonlyArray<[delta: number, score: number]> = [
    [0, 4],
    [24, 4],
    [25, 4], // last step of the 4-wedge
    [26, 3],
    [74, 3],
    [75, 3], // last step of the 3-wedge
    [76, 2],
    [124, 2],
    [125, 2], // last step of the target
    [126, 0], // off the target entirely
    [400, 0],
  ];

  it.each(boundaries)("scores %i steps right of centre as %i", (delta, expected) => {
    expect(scoreNeedle(0.5, 0.5 + step(delta))).toBe(expected);
  });

  it.each(boundaries)("scores %i steps left of centre as %i", (delta, expected) => {
    expect(scoreNeedle(0.5, 0.5 - step(delta))).toBe(expected);
  });

  it("is symmetric about the target centre", () => {
    for (let delta = 0; delta <= 200; delta++) {
      expect(scoreNeedle(0.5, 0.5 + step(delta))).toBe(
        scoreNeedle(0.5, 0.5 - step(delta)),
      );
    }
  });

  it("keeps the whole band on the dial at the extreme target positions", () => {
    // If target generation let the band hang off the edge, these would be 0.
    expect(scoreNeedle(TARGET_MIN_CENTER, 0)).toBe(2);
    expect(scoreNeedle(TARGET_MAX_CENTER, 1)).toBe(2);
  });

  it("survives float arithmetic that would break an epsilon comparison", () => {
    expect(scoreNeedle(0.1 + 0.2, 0.3)).toBe(4);
    expect(scoreNeedle(0.35, 0.35 - 0.02)).toBe(3); // 40 steps -> 3-wedge
    expect(scoreNeedle(0.35, 0.35 - 0.05)).toBe(2); // 100 steps -> 2-wedge
    expect(scoreNeedle(0.7, 0.1 + 0.6)).toBe(4);
  });

  it("never increases as the needle moves further from the target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (t, a, b) => {
          const [near, far] = Math.abs(a - t) <= Math.abs(b - t) ? [a, b] : [b, a];
          expect(scoreNeedle(t, near)).toBeGreaterThanOrEqual(scoreNeedle(t, far));
        },
      ),
      { numRuns: 10_000 },
    );
  });

  it("only ever returns 0, 2, 3 or 4", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (t, n) => {
          expect([0, 2, 3, 4]).toContain(scoreNeedle(t, n));
        },
      ),
    );
  });
});

describe("trueSide", () => {
  it("reports which side of the needle the target is on", () => {
    expect(trueSide(0.3, 0.5)).toBe("left");
    expect(trueSide(0.7, 0.5)).toBe("right");
  });

  it("has no answer when the needle is exactly on the target centre", () => {
    expect(trueSide(0.5, 0.5)).toBeNull();
  });
});

describe("scoreOpponentPrediction", () => {
  const justOutsideFour = step(TARGET_HALF_STEPS.four + 1);
  const insideFour = step(TARGET_HALF_STEPS.four - 5);

  it("awards 1 for a correct call", () => {
    // Target well to the left of the needle, in the 2-wedge.
    expect(scoreOpponentPrediction(0.5 - step(120), 0.5, "left")).toBe(1);
    expect(scoreOpponentPrediction(0.5 + step(120), 0.5, "right")).toBe(1);
  });

  it("awards nothing for an incorrect call", () => {
    expect(scoreOpponentPrediction(0.5 - step(120), 0.5, "right")).toBe(0);
    expect(scoreOpponentPrediction(0.5 + step(120), 0.5, "left")).toBe(0);
  });

  // The rule the prompt left open, and the reason the "needle exactly on
  // centre" case never needs special handling.
  it("is blocked entirely by a bullseye, even when the call was correct", () => {
    expect(scoreNeedle(0.5 + insideFour, 0.5)).toBe(4);
    expect(scoreOpponentPrediction(0.5 + insideFour, 0.5, "right")).toBe(0);
    expect(scoreOpponentPrediction(0.5 + insideFour, 0.5, "left")).toBe(0);
  });

  it("is blocked at the very edge of the 4-wedge but not one step beyond", () => {
    const edge = step(TARGET_HALF_STEPS.four);
    expect(scoreNeedle(0.5 + edge, 0.5)).toBe(4);
    expect(scoreOpponentPrediction(0.5 + edge, 0.5, "right")).toBe(0);

    expect(scoreNeedle(0.5 + justOutsideFour, 0.5)).toBe(3);
    expect(scoreOpponentPrediction(0.5 + justOutsideFour, 0.5, "right")).toBe(1);
  });

  it("still pays out when the active team missed the target completely", () => {
    // The bonus is independent of the active team's success, except for the 4.
    expect(scoreNeedle(0.9, 0.5)).toBe(0);
    expect(scoreOpponentPrediction(0.9, 0.5, "right")).toBe(1);
    expect(scoreOpponentPrediction(0.9, 0.5, "left")).toBe(0);
  });

  it("awards nothing when no call was submitted", () => {
    expect(scoreOpponentPrediction(0.9, 0.5, null)).toBe(0);
  });

  it("awards nothing in the degenerate exact-centre case", () => {
    expect(scoreOpponentPrediction(0.5, 0.5, "left")).toBe(0);
    expect(scoreOpponentPrediction(0.5, 0.5, "right")).toBe(0);
  });

  it("only ever returns 0 or 1, and never pays on a bullseye", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("left" as const, "right" as const),
        (t, n, side) => {
          const bonus = scoreOpponentPrediction(t, n, side);
          expect([0, 1]).toContain(bonus);
          if (scoreNeedle(t, n) === 4) expect(bonus).toBe(0);
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
