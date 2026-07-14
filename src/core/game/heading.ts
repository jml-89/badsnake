import type { Direction, Vec2 } from "./types";
import { UNIT } from "./unit-table";

// The heading model. A heading is an integer index into a ring of HEADINGS
// discrete angles — the quantized generalization of the four cardinal
// directions. This one representation serves both movement modes:
//
//   - cardinal mode keeps the heading pinned to a cardinal index, so movement is
//     bit-identical to the original integer-grid snake;
//   - analog mode lets the heading take any of the HEADINGS values and rotates it
//     by a *bounded* amount per tick (the continuous form of the no-180 rule).
//
// It stays an integer so the game remains a deterministic fold: there is no
// runtime trig anywhere (see unit-table.ts).

/** Number of discrete headings around the ring. A power of two keeps the maths tidy. */
export const HEADINGS = 256;

// Cardinal headings. Increasing index rotates clockwise on screen (y points
// down), so turning right increases the index — matching the original turn table.
export const EAST = 0;
export const SOUTH = 64;
export const WEST = 128;
export const NORTH = 192;

/** A quarter turn, in heading units. */
export const QUARTER = HEADINGS / 4;
/** Half turn — the reversal offset. */
export const HALF = HEADINGS / 2;

export const DIRECTION_INDEX: Record<Direction, number> = {
  north: NORTH,
  east: EAST,
  south: SOUTH,
  west: WEST,
};

/** Unit step vector for a heading. y points down. */
export function unitOf(heading: number): Vec2 {
  return UNIT[wrap(heading)]!;
}

/** Fold any integer into [0, HEADINGS). */
export function wrap(heading: number): number {
  return ((heading % HEADINGS) + HEADINGS) % HEADINGS;
}

/** Rotate a heading by a signed delta, wrapping around the ring. */
export function rotateBy(heading: number, delta: number): number {
  return wrap(heading + delta);
}

/**
 * Shortest signed distance from `from` to `to`, in [-HALF, HALF). Positive means
 * clockwise (increasing index). This is what lets analog steering rotate toward a
 * target the short way, and what makes "is this a 180°?" a simple magnitude test.
 */
export function signedDelta(from: number, to: number): number {
  return wrap(to - from + HALF) - HALF;
}

/** Rotate `heading` toward `target` by at most `maxStep` heading units. */
export function rotateToward(heading: number, target: number, maxStep: number): number {
  const delta = signedDelta(heading, target);
  if (delta > maxStep) return rotateBy(heading, maxStep);
  if (delta < -maxStep) return rotateBy(heading, -maxStep);
  return wrap(target);
}

/** True when two headings point in exactly opposite directions (a 180° reversal). */
export function isReversal(a: number, b: number): boolean {
  return wrap(a - b) === HALF;
}
