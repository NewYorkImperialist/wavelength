import { PIVOT, RADII } from "@/lib/game/constants";
import { describeArcSegment } from "@/lib/game/geometry";

const HALVES = [
  { id: "left", from: 0, to: 0.5, openDeg: -90 },
  { id: "right", from: 0.5, to: 1, openDeg: 90 },
] as const;

/**
 * The screen that hides the target, as two doors swinging outward.
 *
 * Technique: each half is an annular sector rotated about the pivot with a CSS
 * `transform`. Chosen over animating `clip-path` (which interpolates
 * inconsistently across browsers) and over a `<mask>` with a moving gradient
 * (which forces a repaint of the masked subtree every frame and janks on
 * mobile Safari). A transform is GPU-composited everywhere.
 *
 * The doors swing down past the baseline, where the dial's clip path erases
 * them. They sit above the target in document order, so the wedges can be
 * mounted the instant the reveal lands and simply stay occluded until the
 * doors open — no flash of the answer.
 */
export function CoverScreen({ open }: { open: boolean }) {
  return (
    <g>
      {HALVES.map((half, index) => (
        <path
          key={half.id}
          data-testid={`cover-${half.id}`}
          d={describeArcSegment(half.from, half.to, RADII.screenInner, RADII.screenOuter)}
          className="fill-slate-700 stroke-slate-900 transition-transform duration-[650ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:duration-0"
          strokeWidth={3}
          style={{
            transformBox: "view-box",
            transformOrigin: `${PIVOT.x}px ${PIVOT.y}px`,
            transform: `rotate(${open ? half.openDeg : 0}deg)`,
            // A short stagger reads as two doors rather than one shape
            // splitting, and lets the eye land before the score animates in.
            transitionDelay: open ? `${index * 70}ms` : "0ms",
          }}
        />
      ))}
    </g>
  );
}
