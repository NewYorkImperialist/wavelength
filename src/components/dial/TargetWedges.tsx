import { RADII } from "@/lib/game/constants";
import { describeArcSegment, targetWedges, type Position } from "@/lib/game/geometry";

/** Warmer toward the centre, so the bullseye reads instantly. */
const WEDGE_FILL: Record<2 | 3 | 4, string> = {
  2: "fill-amber-200/85",
  3: "fill-orange-400/90",
  4: "fill-rose-500",
};

const LABEL_FILL: Record<2 | 3 | 4, string> = {
  2: "fill-stone-800",
  3: "fill-stone-900",
  4: "fill-white",
};

/**
 * The 2 / 3 / 4 / 3 / 2 scoring band.
 *
 * This component is mounted ONLY when the viewer is entitled to see the
 * target. Non-psychics do not render it at all — it is never hidden with
 * opacity, visibility or a CSS class, because any of those would leave the
 * answer sitting in the DOM.
 */
export function TargetWedges({ center }: { center: Position }) {
  const wedges = targetWedges(center);

  return (
    <g data-testid="target-wedges">
      {wedges.map((wedge, index) => {
        const mid = (wedge.from + wedge.to) / 2;
        // Place the number in the middle of its wedge, reading outward.
        const labelRadius = (RADII.bandInner + RADII.bandOuter) / 2;
        const angle = 180 - mid * 180;
        const x = 500 + labelRadius * Math.cos((angle * Math.PI) / 180);
        const y = 500 - labelRadius * Math.sin((angle * Math.PI) / 180);

        return (
          <g key={`${wedge.points}-${index}`}>
            <path
              d={describeArcSegment(wedge.from, wedge.to, RADII.bandInner, RADII.bandOuter)}
              className={WEDGE_FILL[wedge.points]}
              data-points={wedge.points}
            />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${90 - angle} ${x} ${y})`}
              className={`${LABEL_FILL[wedge.points]} font-bold`}
              fontSize={wedge.points === 4 ? 40 : 34}
            >
              {wedge.points}
            </text>
          </g>
        );
      })}
    </g>
  );
}
