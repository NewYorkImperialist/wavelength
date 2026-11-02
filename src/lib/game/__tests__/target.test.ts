import { describe, expect, it } from "vitest";

import { POSITION_STEPS } from "../constants";
import {
  generateTargetCenter,
  sampleTargetSteps,
  TARGET_MAX_CENTER_STEPS,
  TARGET_MIN_CENTER_STEPS,
} from "../target";

/** Small seeded PRNG, so the distribution checks are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("sampleTargetSteps", () => {
  const rng = mulberry32(42);
  const samples = Array.from({ length: 50_000 }, () => sampleTargetSteps(rng));

  it("always lands on an integer step inside the allowed range", () => {
    for (const s of samples) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(TARGET_MIN_CENTER_STEPS);
      expect(s).toBeLessThanOrEqual(TARGET_MAX_CENTER_STEPS);
    }
  });

  it("can reach both extremes", () => {
    expect(samples).toContain(TARGET_MIN_CENTER_STEPS);
    expect(samples).toContain(TARGET_MAX_CENTER_STEPS);
  });

  it("favours the ends over the middle", () => {
    const fifth = POSITION_STEPS / 5;
    const outer = samples.filter((s) => s < fifth || s > POSITION_STEPS - fifth).length;
    const middle = samples.filter((s) => s >= 2 * fifth && s <= 3 * fifth).length;
    // The two outer fifths, against the middle fifth.
    expect(outer / 2).toBeGreaterThan(2 * middle);
    // ...but the middle still comes up.
    expect(middle / samples.length).toBeGreaterThan(0.05);
  });

  it("treats both ends the same", () => {
    const left = samples.filter((s) => s < POSITION_STEPS / 2).length;
    expect(left / samples.length).toBeGreaterThan(0.48);
    expect(left / samples.length).toBeLessThan(0.52);
  });

  it("terminates and stays in range even with a degenerate rng", () => {
    for (const value of [0, 0.5, 0.999999]) {
      const s = sampleTargetSteps(() => value);
      expect(s).toBeGreaterThanOrEqual(TARGET_MIN_CENTER_STEPS);
      expect(s).toBeLessThanOrEqual(TARGET_MAX_CENTER_STEPS);
    }
  });
});

describe("generateTargetCenter", () => {
  it("is the step sample as a position", () => {
    expect(generateTargetCenter(mulberry32(1)) * POSITION_STEPS).toBe(
      sampleTargetSteps(mulberry32(1)),
    );
  });
});
