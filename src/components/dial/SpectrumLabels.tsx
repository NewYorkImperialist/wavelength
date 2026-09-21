import { PIVOT, RADII } from "@/lib/game/constants";

const LABEL_Y = PIVOT.y + 34;
const MAX_WIDTH = 330;

/**
 * The two poles of the spectrum, below the baseline at either end.
 *
 * `textLength` with `lengthAdjust="spacingAndGlyphs"` is applied only when a
 * label is long enough to collide with the dial, so ordinary labels keep their
 * natural letterforms and only the unusually wordy ones get squeezed.
 */
export function SpectrumLabels({ left, right }: { left: string; right: string }) {
  const needsFitting = (text: string) => text.length > 22;

  return (
    <g className="select-none" style={{ pointerEvents: "none" }}>
      <text
        x={PIVOT.x - RADII.rimOuter + 8}
        y={LABEL_Y}
        textAnchor="start"
        className="fill-sky-200 font-semibold uppercase tracking-wide"
        fontSize={34}
        {...(needsFitting(left)
          ? { textLength: MAX_WIDTH, lengthAdjust: "spacingAndGlyphs" as const }
          : {})}
      >
        {left}
      </text>
      <text
        x={PIVOT.x + RADII.rimOuter - 8}
        y={LABEL_Y}
        textAnchor="end"
        className="fill-amber-200 font-semibold uppercase tracking-wide"
        fontSize={34}
        {...(needsFitting(right)
          ? { textLength: MAX_WIDTH, lengthAdjust: "spacingAndGlyphs" as const }
          : {})}
      >
        {right}
      </text>
    </g>
  );
}
