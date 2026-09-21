/** Random placement of the hidden target. */

import { TARGET_HALF_WIDTH } from "./constants";
import { quantizePosition, type Position } from "./geometry";

/** Leftmost centre at which the whole target band still fits on the dial. */
export const TARGET_MIN_CENTER = TARGET_HALF_WIDTH.two;
/** Rightmost such centre. */
export const TARGET_MAX_CENTER = 1 - TARGET_HALF_WIDTH.two;

/**
 * Sample a target centre uniformly over the interval where the full 2/3/4/3/2
 * band fits on the dial.
 *
 * Two alternatives were rejected:
 *
 * - *Clamping* a full-range sample would pile a point mass of probability on
 *   each endpoint, making "pinned to the edge" the single most likely position
 *   — something observant players would learn to exploit.
 * - *Letting the target hang off the dial* is unfair twice over: part of the
 *   points become unreachable, so an equally good clue scores worse by luck of
 *   the draw; and it hands the opposing team a nearly free left/right bonus,
 *   because near an edge there is barely anywhere for the centre to hide.
 *
 * The cost is that the outer 6.25% of each end is never the answer, which is
 * well within the noise of anyone's mental model of "all the way left".
 *
 * `rng` is injected rather than calling `Math.random`, so the server can use a
 * CSPRNG and tests can be deterministic.
 */
export function generateTargetCenter(rng: () => number): Position {
  const span = TARGET_MAX_CENTER - TARGET_MIN_CENTER;
  return quantizePosition(TARGET_MIN_CENTER + rng() * span);
}
