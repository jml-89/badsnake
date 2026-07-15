// The kernel's data model. All fields are readonly: a GameState is an
// immutable value, and `tick` returns a new one. This is what makes the game
// a deterministic fold over (seed, intent stream).

export type Vec2 = { readonly x: number; readonly y: number };

export type Direction = "north" | "east" | "south" | "west";

export type Turn = "left" | "right";

/**
 * Device-agnostic player intent. The kernel consumes intents, never keycodes.
 *
 * - `steer` is absolute at cardinal resolution ("face north"), natural for arrow
 *   keys and d-pads.
 * - `steerAngle` is absolute at full resolution — a heading *index* (see
 *   `heading.ts`), natural for an analog stick. The device does the trig and
 *   hands the kernel an integer, so determinism is preserved. In cardinal mode
 *   the kernel snaps it to the nearest cardinal.
 * - `turn` is relative ("turn left from the current heading") and is resolved by
 *   the kernel, which owns the heading.
 */
export type Intent =
  | { readonly kind: "steer"; readonly direction: Direction }
  | { readonly kind: "steerAngle"; readonly index: number }
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
   * Body nodes, head first: `snake[0]` is the head, the rest trail behind it at
   * roughly one-cell arc spacing. In cardinal mode every node is an integer cell
   * (the head snaps cell to cell); in analog mode `snake[0]` is a continuous
   * sub-cell position and the trailing nodes are laid down along the path. The
   * renderer and collision treat the list uniformly as a continuous polyline.
   */
  readonly snake: readonly Vec2[];
  /**
   * Facing direction as an angle index in [0, HEADINGS) — see `heading.ts`. The
   * quantized generalization of a cardinal `Direction`; kept integer so the game
   * stays a deterministic fold. In cardinal mode this is the *committed* travel
   * heading — it only changes when the head commits a new cell.
   */
  readonly heading: number;
  /**
   * Cardinal steering is buffered here: the first legal turn requested since the
   * last cell commit, latched until that commit consumes it (null when none is
   * pending). This is what lets the fine simulation step service input every
   * tick without dropping or double-applying a turn between cell commits. Unused
   * in analog mode, where the heading rotates freely each tick.
   */
  readonly pendingHeading: number | null;
  /**
   * Distance travelled toward the next cell commit, in cells [0, 1). Cardinal
   * movement is quantized: this accumulates at the current speed each tick and
   * commits exactly one integer cell whenever it crosses 1 — which is what keeps
   * the grid snap exact regardless of the timestep. Analog movement is
   * continuous and does not use it.
   */
  readonly cellProgress: number;
  /**
   * Target body length in cells. Growth bumps this on eating; each movement step
   * trims the trailing nodes back down to it. Decoupled from `snake.length`
   * because analog can carry a fractional lead node ahead of the last commit.
   */
  readonly lengthCells: number;
  /**
   * Accumulated simulation time in milliseconds — the sum of every `dt` folded
   * in so far. Power-up scheduling is expressed against this (not the integer
   * tick) so its cadence is wall-clock-stable no matter the timestep, while
   * staying a deterministic function of the fixed `dt` data.
   */
  readonly clockMs: number;
  readonly mode: MoveMode;
  /**
   * The joystick power-up token on the board, or null once collected / not
   * present. Walking the head over it switches `mode` to `analog`. Power-ups are
   * transient: they appear on a random cadence and vanish after a short while, so
   * this is null far more often than not.
   */
  readonly powerup: Vec2 | null;
  /**
   * Simulation time (ms, see `clockMs`) at which the current power-up despawns
   * (null when none is on the board). The countdown that creates the grab-it-now
   * urgency.
   */
  readonly powerupExpiresAt: number | null;
  /**
   * Simulation time (ms, see `clockMs`) at which the next power-up should appear
   * (meaningful only while `powerup` is null). Chosen from the seeded RNG, so the
   * cadence is random yet fully deterministic under replay.
   */
  readonly powerupNextAt: number;
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
