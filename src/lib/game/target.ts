/** Random placement of the hidden target. */

import { POSITION_STEPS, TARGET_EDGE_SPREAD, TARGET_HALF_STEPS } from "./constants";
import type { Position } from "./geometry";

/**
 * The extreme target centres, in grid steps: the 4-wedge sits flush against
 * the end of the dial, and the 3 and 2 wedges on that side hang off it.
 *
 * The 4-wedge itself must stay fully on the dial, or a perfect clue could no
 * longer score a perfect 4.
 */
export const TARGET_MIN_CENTER_STEPS = TARGET_HALF_STEPS.four;
export const TARGET_MAX_CENTER_STEPS = POSITION_STEPS - TARGET_HALF_STEPS.four;

/** The same limits as normalized positions. */
export const TARGET_MIN_CENTER = TARGET_MIN_CENTER_STEPS / POSITION_STEPS;
export const TARGET_MAX_CENTER = TARGET_MAX_CENTER_STEPS / POSITION_STEPS;

/** A standard normal sample from two uniforms (Box-Muller). */
function standardNormal(rng: () => number): number {
  // 1 - rng() is in (0, 1], so the log is finite.
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Sample a target centre, in grid steps, weighted toward the ends of the dial.
 *
 * Clues for the extremes come easily ("the hottest thing"); clues for a
 * point a third of the way along are hard. So rather than a uniform draw,
 * each end gets half of a normal curve whose peak sits on the outermost
 * allowed centre: pick an end with a coin flip, then step inward by
 * |N(0, TARGET_EDGE_SPREAD)|. The middle is still reachable, just less often.
 *
 * Draws that would land past the far limit are redrawn (that is under 0.1% of
 * them at the default spread). The retry count is capped so that a broken rng
 * cannot hang the server; the fallback is a plain uniform draw.
 *
 * `rng` returns uniforms in [0, 1). It is injected rather than calling
 * `Math.random`, so the server can use a CSPRNG and tests can be
 * deterministic.
 */
export function sampleTargetSteps(rng: () => number): number {
  const span = TARGET_MAX_CENTER_STEPS - TARGET_MIN_CENTER_STEPS;
  const sigma = TARGET_EDGE_SPREAD * POSITION_STEPS;

  for (let attempt = 0; attempt < 32; attempt++) {
    const fromLeft = rng() < 0.5;
    const inward = Math.round(Math.abs(standardNormal(rng)) * sigma);
    if (inward > span) continue;
    return fromLeft
      ? TARGET_MIN_CENTER_STEPS + inward
      : TARGET_MAX_CENTER_STEPS - inward;
  }
  return TARGET_MIN_CENTER_STEPS + Math.min(span, Math.floor(rng() * (span + 1)));
}

/** `sampleTargetSteps` as a normalized position. */
export function generateTargetCenter(rng: () => number): Position {
  return sampleTargetSteps(rng) / POSITION_STEPS;
}
