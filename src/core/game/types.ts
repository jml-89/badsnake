// The kernel's data model. All fields are readonly: a GameState is an
// immutable value, and `tick` returns a new one. This is what makes the game
// a deterministic fold over (seed, intent stream).

export type Vec2 = { readonly x: number; readonly y: number };

export type Direction = "north" | "east" | "south" | "west";

export type Turn = "left" | "right";

/**
 * Device-agnostic player intent. The kernel consumes intents, never keycodes.
 * `steer` is absolute ("face north"); `turn` is relative ("turn left from the
 * current heading") and is resolved by the kernel, which owns the heading.
 */
export type Intent =
  | { readonly kind: "steer"; readonly direction: Direction }
  | { readonly kind: "turn"; readonly turn: Turn }
  | { readonly kind: "pause" }
  | { readonly kind: "restart" };

export type Phase = "playing" | "paused" | "dead";

/**
 * How the snake steers.
 *
 * - `cardinal` — the original four-direction snake. The heading stays pinned to a
 *   cardinal angle and moves in exact 1-cell axis steps.
 * - `analog` — unlocked by the joystick power-up. The heading can point in any of
 *   the discrete angles and rotates by a bounded amount per tick.
 *
 * Both modes share one representation (a continuous body + an angle-index
 * heading), so the switch flips a field and needs no conversion.
 */
export type MoveMode = "cardinal" | "analog";

export type GameState = {
  readonly width: number;
  readonly height: number;
  /**
   * Body segments, head first. Cells are integer-valued in cardinal mode and
   * may be sub-cell floats in analog mode — the renderer and collision treat
   * them uniformly as continuous positions.
   */
  readonly snake: readonly Vec2[];
  /**
   * Facing direction as an angle index in [0, HEADINGS) — see `heading.ts`. The
   * quantized generalization of a cardinal `Direction`; kept integer so the game
   * stays a deterministic fold.
   */
  readonly heading: number;
  readonly mode: MoveMode;
  /**
   * The joystick power-up token on the board, or null once collected / not
   * present. Walking the head over it switches `mode` to `analog`.
   */
  readonly powerup: Vec2 | null;
  readonly food: Vec2;
  readonly phase: Phase;
  readonly score: number;
  /** Integer simulation tick — the timeline an intent stream indexes into. */
  readonly tick: number;
  /**
   * Seeded PRNG state, carried in the state itself so the entire game stays a
   * pure fold. The seed is the injected dependency; everything after is
   * deterministic.
   */
  readonly rngState: number;
};
