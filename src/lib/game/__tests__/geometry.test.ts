import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PIVOT, POSITION_STEPS, RADII, TARGET_SPAN } from "../constants";
import {
  angleToPosition,
  clamp01,
  clampAngleToDial,
  describeArcSegment,
  needleLine,
  pointAtPosition,
  pointToPosition,
  polarToCartesian,
  positionToAngle,
  positionToSteps,
  quantizePosition,
  targetWedges,
} from "../geometry";

/** Every position on the quantization grid. */
const GRID: number[] = Array.from(
  { length: POSITION_STEPS + 1 },
  (_, i) => i / POSITION_STEPS,
);

describe("clamping and quantization", () => {
  it("clamps out-of-range input", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });

  it("holds the centre for NaN rather than producing a NaN position", () => {
    expect(clamp01(Number.NaN)).toBe(0.5);
    expect(quantizePosition(Number.NaN)).toBe(0.5);
  });

  it("snaps to the grid", () => {
    expect(quantizePosition(0.50001)).toBe(0.5);
    expect(quantizePosition(0.12345)).toBe(positionToSteps(0.12345) / POSITION_STEPS);
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (p) => {
        const once = quantizePosition(p);
        expect(quantizePosition(once)).toBe(once);
      }),
    );
  });
});

describe("position <-> angle", () => {
  it("maps the dial ends and centre", () => {
    expect(positionToAngle(0)).toBe(180);
    expect(positionToAngle(0.25)).toBe(135);
    expect(positionToAngle(0.5)).toBe(90);
    expect(positionToAngle(0.75)).toBe(45);
    expect(positionToAngle(1)).toBe(0);
  });

  it("round-trips every grid position exactly after quantization", () => {
    for (const p of GRID) {
      expect(quantizePosition(angleToPosition(positionToAngle(p)))).toBe(p);
    }
  });

  it("clamps angles onto the upper semicircle", () => {
    expect(clampAngleToDial(200)).toBe(180);
    expect(clampAngleToDial(-20)).toBe(0);
    expect(clampAngleToDial(90)).toBe(90);
  });
});

describe("polar to cartesian", () => {
  // These three pin the SVG y-down flip. If the sign is ever wrong the dial
  // renders upside down, and these fail loudly.
  it("puts 90 degrees straight UP on screen", () => {
    const p = polarToCartesian(100, 90, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(-100, 10);
  });

  it("puts 0 degrees to the right and 180 to the left", () => {
    const right = polarToCartesian(100, 0, { x: 0, y: 0 });
    expect(right.x).toBeCloseTo(100, 10);
    expect(right.y).toBeCloseTo(0, 10);

    const left = polarToCartesian(100, 180, { x: 0, y: 0 });
    expect(left.x).toBeCloseTo(-100, 10);
    expect(left.y).toBeCloseTo(0, 10);
  });
});

describe("point to position", () => {
  it("inverts pointAtPosition for every grid position", () => {
    for (const p of GRID) {
      const point = pointAtPosition(p, 300);
      expect(quantizePosition(pointToPosition(point.x, point.y))).toBe(p);
    }
  });

  it("does not depend on distance from the pivot", () => {
    for (const p of [0, 0.2, 0.5, 0.8, 1]) {
      const near = pointAtPosition(p, 10);
      const far = pointAtPosition(p, 450);
      expect(quantizePosition(pointToPosition(near.x, near.y))).toBe(
        quantizePosition(pointToPosition(far.x, far.y)),
      );
    }
  });

  it("snaps to the nearer end below the baseline instead of wrapping", () => {
    expect(pointToPosition(PIVOT.x + 50, PIVOT.y + 200)).toBe(1);
    expect(pointToPosition(PIVOT.x - 50, PIVOT.y + 200)).toBe(0);
    expect(pointToPosition(PIVOT.x + 50, PIVOT.y)).toBe(1);
  });

  it("holds the centre exactly on the pivot", () => {
    expect(pointToPosition(PIVOT.x, PIVOT.y)).toBe(0.5);
  });

  it("never returns a value outside the dial", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (x, y) => {
          const p = pointToPosition(x, y);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("describeArcSegment", () => {
  const d = describeArcSegment(0.3, 0.7, RADII.bandInner, RADII.bandOuter);

  it("sweeps the outer arc clockwise and the inner arc back", () => {
    expect(d).toContain(`A ${RADII.bandOuter} ${RADII.bandOuter} 0 0 1`);
    expect(d).toContain(`A ${RADII.bandInner} ${RADII.bandInner} 0 0 0`);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("produces a pie slice from the pivot when the inner radius is zero", () => {
    const slice = describeArcSegment(0.4, 0.6, 0, RADII.bandOuter);
    expect(slice.startsWith(`M ${PIVOT.x} ${PIVOT.y}`)).toBe(true);
    expect(slice).toContain(" L ");
  });

  it("puts a full-width band at the dial's edges", () => {
    const full = describeArcSegment(0, 1, RADII.bandInner, RADII.bandOuter);
    // Derived from the constants so a radius change doesn't silently rot this.
    expect(full).toContain(`M ${PIVOT.x - RADII.bandOuter} ${PIVOT.y}`);
    expect(full).toContain(`${PIVOT.x + RADII.bandOuter} ${PIVOT.y}`);
  });

  it("is order-insensitive", () => {
    expect(describeArcSegment(0.7, 0.3, RADII.bandInner, RADII.bandOuter)).toBe(d);
  });

  it("never emits NaN or exponential notation", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const path = describeArcSegment(a, b, RADII.bandInner, RADII.bandOuter);
          expect(path).not.toMatch(/NaN/);
          expect(path).not.toMatch(/e[+-]/i);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("targetWedges", () => {
  const wedges = targetWedges(0.5);

  it("is 2 / 3 / 4 / 3 / 2 from left to right", () => {
    expect(wedges.map((w) => w.points)).toEqual([2, 3, 4, 3, 2]);
  });

  it("is contiguous and non-overlapping", () => {
    for (let i = 1; i < wedges.length; i++) {
      expect(wedges[i]!.from).toBeCloseTo(wedges[i - 1]!.to, 12);
    }
  });

  it("spans exactly TARGET_SPAN and is centred on the target", () => {
    const first = wedges[0]!;
    const last = wedges[wedges.length - 1]!;
    expect(last.to - first.from).toBeCloseTo(TARGET_SPAN, 12);
    expect((first.from + last.to) / 2).toBeCloseTo(0.5, 12);
  });

  it("keeps the 4-wedge symmetric about the target centre", () => {
    const four = wedges[2]!;
    expect(0.5 - four.from).toBeCloseTo(four.to - 0.5, 12);
  });

  it("has five bands of equal width", () => {
    const widths = wedges.map((w) => w.to - w.from);
    for (const width of widths) {
      expect(width).toBeCloseTo(widths[0]!, 12);
    }
  });
});

describe("needleLine", () => {
  it("extends past the pivot so the needle is balanced", () => {
    const { tip, tail } = needleLine(0.5);
    expect(tip.y).toBeLessThan(PIVOT.y);
    expect(tail.y).toBeGreaterThan(PIVOT.y);
  });
});
