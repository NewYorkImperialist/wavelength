/**
 * Every number the Wavelength dial and rules depend on, named and in one place.
 * Nothing else in the codebase should contain a dial or scoring magic number.
 */

// ---------------------------------------------------------------------------
// Position quantization
// ---------------------------------------------------------------------------

/**
 * Normalized positions (0 = far left, 0.5 = centre, 1 = far right) are snapped
 * onto an integer grid of this many steps.
 *
 * This is what makes scoring exact: `scoreNeedle` compares integer step counts,
 * never floats, so there is no epsilon, no `0.1 + 0.2` hazard, and no boundary
 * that behaves differently depending on how the value was computed.
 */
export const POSITION_STEPS = 2000;

// ---------------------------------------------------------------------------
// Dial arc
//
// Angles are math convention: 0 degrees = due right, 90 = straight up,
// 180 = due left, increasing counter-clockwise as seen on screen. SVG's y axis
// grows downward, so the flip between these angles and SVG coordinates lives in
// exactly two functions in geometry.ts and nowhere else.
// ---------------------------------------------------------------------------

export const DIAL_ARC_DEGREES = 180;
/** Normalized position 0 sits here. */
export const DIAL_ANGLE_AT_MIN = 180;
/** Normalized position 1 sits here. */
export const DIAL_ANGLE_AT_MAX = 0;

// ---------------------------------------------------------------------------
// SVG user-unit space
//
// The dial is drawn once in these units and scaled by the viewBox, so it looks
// right on a 375px phone and on a projector without measuring the DOM.
// ---------------------------------------------------------------------------

export const VIEWBOX = { minX: 0, minY: 0, width: 1000, height: 540 } as const;
export const PIVOT = { x: 500, y: 500 } as const;

export const RADII = {
  rimOuter: 478,
  rimInner: 462,
  /** The cover screen is an annulus over the scoring band. */
  screenOuter: 462,
  screenInner: 286,
  /** The 2/3/4/3/2 target band. */
  bandOuter: 452,
  bandInner: 300,
  tickOuter: 462,
  tickInner: 440,
  needleTip: 448,
  /** Negative: the needle extends past the pivot, so it balances visually. */
  needleTail: -70,
  hub: 54,
} as const;

// ---------------------------------------------------------------------------
// Target band
//
// The physical game's exact wedge widths were never published. We use a target
// spanning 12.5% of the dial as five equal 2.5% wedges. These three integers
// are the only thing to change when retuning difficulty after playtesting.
// ---------------------------------------------------------------------------

/** Half-widths from the target centre, in grid steps. Integers, deliberately. */
export const TARGET_HALF_STEPS = {
  /** The 4-point wedge: centre +/- 25 steps = 2.5% of the dial. */
  four: 25,
  /** Outer edge of the 3-point wedges. */
  three: 75,
  /** Outer edge of the 2-point wedges, i.e. the edge of the target. */
  two: 125,
} as const;

/** The same half-widths as normalized positions. Derived, never hardcoded. */
export const TARGET_HALF_WIDTH = {
  four: TARGET_HALF_STEPS.four / POSITION_STEPS,
  three: TARGET_HALF_STEPS.three / POSITION_STEPS,
  two: TARGET_HALF_STEPS.two / POSITION_STEPS,
} as const;

/** Total width of the target, edge to edge. */
export const TARGET_SPAN = 2 * TARGET_HALF_WIDTH.two;

// ---------------------------------------------------------------------------
// Keyboard control of the needle
// ---------------------------------------------------------------------------

export const KEYBOARD_STEP = 0.005;
export const KEYBOARD_STEP_FINE = 0.001;
export const KEYBOARD_STEP_COARSE = 0.05;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** First team to reach this ends the game; the higher score wins. */
export const WINNING_SCORE = 10;
export const MIN_PLAYERS_PER_TEAM_TO_START = 2;
export const MAX_CLUE_LENGTH = 120;
