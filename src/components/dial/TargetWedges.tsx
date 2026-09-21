import { RADII } from "@/lib/game/constants";
import {
  describeArcSegment,
  pointAtPosition,
  positionToAngle,
  targetWedges,
  type Position,
  type Wedge,
} from "@/lib/game/geometry";

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

/** Numbers sit mid-band, rotated so their "up" points away from the pivot. */
function labelPlacement(wedge: Wedge) {
  const mid = (wedge.from + wedge.to) / 2;
  const radius = (RADII.bandInner + RADII.bandOuter) / 2;
  const point = pointAtPosition(mid, radius);
  return { ...point, rotation: 90 - positionToAngle(mid) };
}

/**
 * The 2 / 3 / 4 / 3 / 2 scoring band.
 *
 * Mounted ONLY when the viewer is entitled to see the target. Non-psychics do
 * not render it at all — never hidden with opacity, visibility or a class,
 * because any of those would leave the answer sitting in the DOM.
 *
 * Painted in three passes so the centre mark can sit above the coloured bands
 * without obscuring the numbers.
 */
export function TargetWedges({
  center,
  showCentreMark = false,
}: {
  center: Position;
  /**
   * At the reveal, a hairline through the exact centre. The opposing team's
   * entire call is "is the centre left or right of the needle", so at the
   * moment of truth that centre should be a line you can sight along rather
   * than something eyeballed from the middle of a coloured band.
   */
  showCentreMark?: boolean;
}) {
  const wedges = targetWedges(center);
  const markInner = pointAtPosition(center, RADII.bandInner - 18);
  const markOuter = pointAtPosition(center, RADII.bandOuter + 14);

  return (
    <g data-testid="target-wedges">
      {wedges.map((wedge, index) => (
        <path
          key={`band-${index}`}
          d={describeArcSegment(wedge.from, wedge.to, RADII.bandInner, RADII.bandOuter)}
          className={WEDGE_FILL[wedge.points]}
          data-points={wedge.points}
        />
      ))}

      {showCentreMark && (
        <g data-testid="target-centre-mark">
          <line
            x1={markInner.x}
            y1={markInner.y}
            x2={markOuter.x}
            y2={markOuter.y}
            className="stroke-stone-900"
            strokeWidth={6}
            strokeLinecap="round"
          />
          <line
            x1={markInner.x}
            y1={markInner.y}
            x2={markOuter.x}
            y2={markOuter.y}
            className="stroke-white"
            strokeWidth={2.5}
            strokeDasharray="9 7"
            strokeLinecap="round"
          />
          <circle cx={markOuter.x} cy={markOuter.y} r={7} className="fill-white" />
        </g>
      )}

      {wedges.map((wedge, index) => {
        const { x, y, rotation } = labelPlacement(wedge);
        return (
          <text
            key={`label-${index}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(${rotation} ${x} ${y})`}
            className={`${LABEL_FILL[wedge.points]} font-bold`}
            fontSize={wedge.points === 4 ? 40 : 34}
            // Painted last, over the centre mark, so the values stay legible.
            paintOrder="stroke"
          >
            {wedge.points}
          </text>
        );
      })}
    </g>
  );
}
