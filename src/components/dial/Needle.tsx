import type { KeyboardEventHandler, PointerEventHandler } from "react";

import { PIVOT, RADII } from "@/lib/game/constants";
import { needleLine, type Position } from "@/lib/game/geometry";

export interface NeedleProps {
  position: Position;
  interactive: boolean;
  leftLabel: string;
  rightLabel: string;
  onPointerDown?: PointerEventHandler<SVGGElement>;
  onKeyDown?: KeyboardEventHandler<SVGGElement>;
}

/**
 * The needle, and the control surface for it.
 *
 * `aria-valuenow` runs 0–1000 rather than 0–1 because several screen readers
 * round a fractional value to "0" or "1" and announce nothing useful;
 * `aria-valuetext` carries the reading a person actually wants.
 */
export function Needle({
  position,
  interactive,
  leftLabel,
  rightLabel,
  onPointerDown,
  onKeyDown,
}: NeedleProps) {
  const { tip, tail } = needleLine(position);
  const percentToRight = Math.round(position * 100);

  return (
    <g
      data-testid="needle"
      tabIndex={interactive ? 0 : -1}
      role="slider"
      aria-label={`Needle between ${leftLabel} and ${rightLabel}`}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={1000}
      aria-valuenow={Math.round(position * 1000)}
      aria-valuetext={`${percentToRight}% toward ${rightLabel}`}
      aria-disabled={!interactive}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`focus:outline-none ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ transition: "none" }}
    >
      {/* Generous invisible hit area: thumb-sized without thickening the
          needle. pointerEvents on the stroke only, so the gap either side of
          the line still falls through to the dial face for tap-to-jump. */}
      <line
        x1={tail.x}
        y1={tail.y}
        x2={tip.x}
        y2={tip.y}
        stroke="transparent"
        strokeWidth={56}
        strokeLinecap="round"
        style={{ pointerEvents: interactive ? "stroke" : "none" }}
      />
      <line
        x1={tail.x}
        y1={tail.y}
        x2={tip.x}
        y2={tip.y}
        className="needle-shaft stroke-red-600"
        strokeWidth={7}
        strokeLinecap="round"
        style={{ pointerEvents: "none" }}
      />
      <circle
        cx={tip.x}
        cy={tip.y}
        r={9}
        className="fill-red-500"
        style={{ pointerEvents: "none" }}
      />
    </g>
  );
}

/** The pivot cap, drawn over the needle's tail so the joint looks mechanical. */
export function DialHub() {
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={PIVOT.x} cy={PIVOT.y} r={RADII.hub} className="fill-stone-700" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r={RADII.hub - 12} className="fill-stone-600" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r={8} className="fill-stone-900" />
    </g>
  );
}
