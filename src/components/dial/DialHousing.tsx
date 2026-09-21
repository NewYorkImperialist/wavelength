import { PIVOT, RADII } from "@/lib/game/constants";
import { describeArcSegment, pointAtPosition } from "@/lib/game/geometry";

const DEFAULT_TICK_COUNT = 25;

/**
 * The physical body of the device: the outer rim, the recessed face, and the
 * tick marks along the edge that give the needle something to read against.
 */
export function DialHousing({ tickCount = DEFAULT_TICK_COUNT }: { tickCount?: number }) {
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const position = i / (tickCount - 1);
    // Every fifth tick is a major one, as on the printed board.
    const isMajor = i % 5 === 0;
    const inner = pointAtPosition(
      position,
      isMajor ? RADII.tickInner : RADII.tickInner + 10,
    );
    const outer = pointAtPosition(position, RADII.tickOuter);
    return { position, inner, outer, isMajor };
  });

  return (
    <g>
      {/* Outer rim */}
      <path
        d={describeArcSegment(0, 1, RADII.rimInner, RADII.rimOuter)}
        className="fill-stone-700"
      />
      {/* Recessed face the target sits in */}
      <path
        d={describeArcSegment(0, 1, RADII.bandInner - 14, RADII.rimInner)}
        className="fill-stone-900"
      />
      {/* Inner well below the scoring band */}
      <path
        d={describeArcSegment(0, 1, 0, RADII.bandInner - 14)}
        className="fill-stone-800"
      />

      {ticks.map((tick) => (
        <line
          key={tick.position}
          x1={tick.inner.x}
          y1={tick.inner.y}
          x2={tick.outer.x}
          y2={tick.outer.y}
          strokeWidth={tick.isMajor ? 4 : 2}
          className={tick.isMajor ? "stroke-stone-400" : "stroke-stone-600"}
          strokeLinecap="round"
        />
      ))}

      {/* Baseline the needle pivots on */}
      <line
        x1={PIVOT.x - RADII.rimOuter}
        y1={PIVOT.y}
        x2={PIVOT.x + RADII.rimOuter}
        y2={PIVOT.y}
        className="stroke-stone-700"
        strokeWidth={3}
      />
    </g>
  );
}
