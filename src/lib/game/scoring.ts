/**
 * The single authoritative implementation of Wavelength's scoring rules.
 *
 * The server imports this to compute the score of record; the client imports
 * the same module to draw the result. There is no second copy.
 */

import { TARGET_HALF_STEPS } from "./constants";
import { positionToSteps, type Position } from "./geometry";
import type { BonusScore, Side, WedgeScore } from "./types";

/**
 * Points the active team scores for a needle at `needlePosition`.
 *
 * Boundary semantics: each band is *closed* at its outer edge, so a needle
 * exactly on a wedge line scores the higher value. Player-friendly, and
 * deterministic.
 *
 * Float safety: the comparison happens entirely in integer grid steps, so
 * there is no epsilon anywhere. `scoreNeedle(t, t) === 4` holds for every `t`
 * by construction, since a distance of 0 is always within the 4-wedge.
 */
export function scoreNeedle(
  targetCenter: Position,
  needlePosition: Position,
): WedgeScore {
  const distance = Math.abs(
    positionToSteps(targetCenter) - positionToSteps(needlePosition),
  );
  if (distance <= TARGET_HALF_STEPS.four) return 4;
  if (distance <= TARGET_HALF_STEPS.three) return 3;
  if (distance <= TARGET_HALF_STEPS.two) return 2;
  return 0;
}

/**
 * Which side of the needle the true target centre lies on.
 * Null when they coincide exactly, where "left or right" has no answer.
 */
export function trueSide(
  targetCenter: Position,
  needlePosition: Position,
): Side | null {
  const target = positionToSteps(targetCenter);
  const needle = positionToSteps(needlePosition);
  if (target === needle) return null;
  return target < needle ? "left" : "right";
}

/**
 * The opposing team's bonus: 1 point for calling the correct side.
 *
 * A bullseye by the active team blocks it entirely — that is the real rule,
 * and it is also what makes the "needle exactly on the centre" case moot,
 * since that is always a 4.
 *
 * Note the bonus is otherwise independent of the active team's success: if the
 * needle misses the target completely but the side was called right, the
 * opponents still score.
 */
export function scoreOpponentPrediction(
  targetCenter: Position,
  needlePosition: Position,
  prediction: Side | null,
): BonusScore {
  if (prediction === null) return 0;
  if (scoreNeedle(targetCenter, needlePosition) === 4) return 0;

  const side = trueSide(targetCenter, needlePosition);
  // Unreachable while the 4-wedge has non-zero width (distance 0 scores 4),
  // but kept so the function stays total if the wedge constants are retuned.
  if (side === null) return 0;

  return side === prediction ? 1 : 0;
}
