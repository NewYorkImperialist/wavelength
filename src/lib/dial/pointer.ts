/**
 * The DOM-facing half of the dial geometry.
 *
 * `src/lib/game/geometry.ts` stays free of browser types so it can run on the
 * server; the one function that genuinely needs an `SVGSVGElement` lives here.
 */

import { PIVOT } from "@/lib/game/constants";
import {
  pointToPosition,
  quantizePosition,
  type Point,
  type Position,
} from "@/lib/game/geometry";

/**
 * Convert a pointer's client coordinates to a dial position.
 *
 * `getScreenCTM().inverse()` absorbs viewBox scaling, `preserveAspectRatio`
 * letterboxing, page scroll, CSS transforms and device pixel ratio in one step
 * — which is why the dial needs no resize listener and behaves identically on
 * a 375px phone and a projector.
 */
export function pointerToPosition(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  pivot: Point = PIVOT,
): Position {
  const ctm = svg.getScreenCTM();
  if (ctm === null) return 0.5;

  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return quantizePosition(pointToPosition(point.x, point.y, pivot));
}
