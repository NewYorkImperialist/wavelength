/**
 * Dial geometry: normalized position <-> angle <-> SVG coordinates.
 *
 * Pure. No React, no DOM. The one DOM-dependent helper (converting a
 * PointerEvent to a position via `getScreenCTM`) lives with the components,
 * built on `pointToPosition` below.
 */

import {
  DIAL_ANGLE_AT_MIN,
  DIAL_ARC_DEGREES,
  PIVOT,
  POSITION_STEPS,
  RADII,
  TARGET_HALF_WIDTH,
} from "./constants";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Normalized dial position: 0 = far left, 0.5 = centre, 1 = far right. */
export type Position = number;

const DEGREES_TO_RADIANS = Math.PI / 180;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Snap onto the integer grid. Call this at every ingress — pointer input,
 * keyboard input, values arriving over the network — so that positions
 * compared anywhere in the app are comparable exactly.
 */
export function quantizePosition(p: number): Position {
  return Math.round(clamp01(p) * POSITION_STEPS) / POSITION_STEPS;
}

/** The integer step count for a position. Scoring works in these units. */
export function positionToSteps(p: number): number {
  return Math.round(clamp01(p) * POSITION_STEPS);
}

// ---------------------------------------------------------------------------
// position <-> angle
// ---------------------------------------------------------------------------

/** 0 -> 180 degrees, 0.5 -> 90, 1 -> 0. */
export function positionToAngle(p: Position): number {
  return DIAL_ANGLE_AT_MIN - clamp01(p) * DIAL_ARC_DEGREES;
}

export function angleToPosition(deg: number): Position {
  return clamp01((DIAL_ANGLE_AT_MIN - deg) / DIAL_ARC_DEGREES);
}

/** Clamp an arbitrary angle onto the dial's upper semicircle, [0, 180]. */
export function clampAngleToDial(deg: number): number {
  if (deg > DIAL_ANGLE_AT_MIN) return DIAL_ANGLE_AT_MIN;
  if (deg < 0) return 0;
  return deg;
}

// ---------------------------------------------------------------------------
// polar <-> cartesian
// ---------------------------------------------------------------------------

/**
 * Math-convention polar to SVG cartesian.
 *
 * The `-` on y is one of only two places in the codebase that knows SVG's y
 * axis grows downward. Keep it that way.
 */
export function polarToCartesian(
  radius: number,
  angleDeg: number,
  pivot: Point = PIVOT,
): Point {
  const a = angleDeg * DEGREES_TO_RADIANS;
  return {
    x: pivot.x + radius * Math.cos(a),
    y: pivot.y - radius * Math.sin(a),
  };
}

export function pointAtPosition(
  p: Position,
  radius: number,
  pivot: Point = PIVOT,
): Point {
  return polarToCartesian(radius, positionToAngle(p), pivot);
}

// ---------------------------------------------------------------------------
// pointer -> position
// ---------------------------------------------------------------------------

/**
 * Convert a point in SVG user units to a dial position.
 *
 * The `pivot.y - y` is the second and last place that knows about SVG's y-down
 * orientation. Distance from the pivot is irrelevant — only the angle matters —
 * so grabbing the needle near the hub works as well as near the tip.
 */
export function pointToPosition(
  x: number,
  y: number,
  pivot: Point = PIVOT,
): Position {
  const dx = x - pivot.x;
  const dy = pivot.y - y;

  // Exactly on the pivot: no meaningful angle, so hold the centre.
  if (dx === 0 && dy === 0) return 0.5;

  // At or below the baseline the dial has run out; snap to the nearer end
  // rather than wrapping around to the other side.
  if (dy <= 0) return dx >= 0 ? 1 : 0;

  const deg = Math.atan2(dy, dx) / DEGREES_TO_RADIANS;
  return angleToPosition(clampAngleToDial(deg));
}

// ---------------------------------------------------------------------------
// path building
// ---------------------------------------------------------------------------

/** Round for SVG output: 3dp is well below a pixel, and never exponential. */
function svgNumber(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  // `toFixed` then trim avoids exponential notation for very small magnitudes.
  return Object.is(rounded, -0) ? "0" : rounded.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * An annular sector between two normalized positions and two radii — or a pie
 * slice when `rInner <= 0`.
 *
 * Sweep flags: the outer arc runs left to right over the top of the dial, which
 * is clockwise in SVG's y-down space, hence sweep-flag 1. The inner arc returns
 * right to left, hence 0. A segment can never exceed 180 degrees, so the
 * large-arc flag is always 0.
 */
export function describeArcSegment(
  from: Position,
  to: Position,
  rInner: number,
  rOuter: number,
  pivot: Point = PIVOT,
): string {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const outerStart = pointAtPosition(a, rOuter, pivot);
  const outerEnd = pointAtPosition(b, rOuter, pivot);

  if (rInner <= 0) {
    return (
      `M ${svgNumber(pivot.x)} ${svgNumber(pivot.y)}` +
      ` L ${svgNumber(outerStart.x)} ${svgNumber(outerStart.y)}` +
      ` A ${svgNumber(rOuter)} ${svgNumber(rOuter)} 0 0 1 ${svgNumber(outerEnd.x)} ${svgNumber(outerEnd.y)}` +
      ` Z`
    );
  }

  const innerEnd = pointAtPosition(b, rInner, pivot);
  const innerStart = pointAtPosition(a, rInner, pivot);
  return (
    `M ${svgNumber(outerStart.x)} ${svgNumber(outerStart.y)}` +
    ` A ${svgNumber(rOuter)} ${svgNumber(rOuter)} 0 0 1 ${svgNumber(outerEnd.x)} ${svgNumber(outerEnd.y)}` +
    ` L ${svgNumber(innerEnd.x)} ${svgNumber(innerEnd.y)}` +
    ` A ${svgNumber(rInner)} ${svgNumber(rInner)} 0 0 0 ${svgNumber(innerStart.x)} ${svgNumber(innerStart.y)}` +
    ` Z`
  );
}

// ---------------------------------------------------------------------------
// derived shapes
// ---------------------------------------------------------------------------

export interface Wedge {
  readonly points: 2 | 3 | 4;
  readonly from: Position;
  readonly to: Position;
}

/** The five scoring wedges, left to right, for a given target centre. */
export function targetWedges(center: Position): readonly Wedge[] {
  const { four, three, two } = TARGET_HALF_WIDTH;
  return [
    { points: 2, from: center - two, to: center - three },
    { points: 3, from: center - three, to: center - four },
    { points: 4, from: center - four, to: center + four },
    { points: 3, from: center + four, to: center + three },
    { points: 2, from: center + three, to: center + two },
  ];
}

export function needleLine(
  p: Position,
  pivot: Point = PIVOT,
): { tip: Point; tail: Point } {
  return {
    tip: pointAtPosition(p, RADII.needleTip, pivot),
    tail: pointAtPosition(p, RADII.needleTail, pivot),
  };
}
