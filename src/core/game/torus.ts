import type { Vec2 } from "./types";

// --- The board is a flat torus (when the walls become portals) --------------
// With the 🌀 portal power-up the lethal walls turn into wraps: leaving the right
// edge is the *same point* as entering the left. Positions are still stored as
// plain coordinates in [0, size), so any raw subtraction between two of them is
// wrong across that seam — a head at 0.1 and the node behind it at 19.6 are one
// cell apart on the board, but 19.5 apart by naive arithmetic.
//
// This module is the ONE place that fact lives. Movement spacing, self-collision,
// and render interpolation all ask it for a displacement (or a distance) and are
// correct by construction, whether or not the edge wraps — instead of each site
// re-deriving, or forgetting, the seam. It is the spatial twin of `signedDelta`
// in heading.ts, which does the same minimum-image trick on the ring of headings.
//
// It is pure and uses only basic float arithmetic and `Math.sqrt` (correctly
// rounded), so it stays inside the deterministic-fold guarantee.

/**
 * Shortest signed displacement from `a` to `b` on an axis of length `size`. When
 * the axis wraps (`wrap` true, portal on) the result is folded into the half-open
 * interval (-size/2, size/2], so a step off one edge reads as a small move onto
 * the other rather than a whole-board jump; when it does not wrap it is the plain
 * difference `b - a`.
 *
 * This is exact — not a threshold heuristic — whenever the two points are less
 * than half a board apart the short way, which every caller here guarantees: one
 * render tick of travel, or one cell of node spacing, is « size/2.
 */
export function axisDelta(a: number, b: number, size: number, wrap: boolean): number {
  const d = b - a;
  return wrap ? ((d + size / 2) % size + size) % size - size / 2 : d;
}

/** Fold a coordinate back onto the board [0, size) — the portal re-entry map. */
export function wrapAxis(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/** Fold a point back onto the board — `wrapAxis` on each axis. */
export function wrapVec(p: Vec2, width: number, height: number): Vec2 {
  return { x: wrapAxis(p.x, width), y: wrapAxis(p.y, height) };
}

/**
 * Euclidean distance between two points, taking each axis's shortest path when
 * the edge wraps. Reduces to the plain distance when it does not — so callers
 * pass the current `edgeWrap` and get classic behaviour off, toroidal on, from
 * one call. (`sqrt` is correctly rounded, keeping this deterministic.)
 */
export function torusDist(a: Vec2, b: Vec2, width: number, height: number, wrap: boolean): number {
  const dx = axisDelta(a.x, b.x, width, wrap);
  const dy = axisDelta(a.y, b.y, height, wrap);
  return Math.sqrt(dx * dx + dy * dy);
}
