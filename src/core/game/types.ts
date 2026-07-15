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
 * - `analog` — unlocked by the 🕹️ joystick power-up. The heading can point in any
 *   of the discrete angles and rotates by a bounded amount per tick.
 *
 * Both modes share one representation (a continuous body + an angle-index
 * heading), so the switch flips a field and needs no conversion. The 📐 digital
 * power-up flips it back to `cardinal` — the inverse of the joystick.
 */
export type MoveMode = "cardinal" | "analog";

/**
 * The kinds of power-up token that can appear on the board. Each one, when the
 * head walks over it, applies a distinct persistent effect to the game state.
 * The kernel carries only the *kind* (a value); the renderer owns how each is
 * drawn (an emoji) — presentation never leaks into the pure model.
 *
 * - `analog`  🕹️ — switch steering to continuous/analog (the original power-up).
 * - `digital` 📐 — switch steering back to the crisp cardinal grid (the inverse).
 * - `portal`  🌀 — turn off the lethal walls; the board edge wraps Pac-Man-style.
 * - `threeD`  🧊 — render the snake with real depth (a rendering-only flourish).
 */
export type PowerupKind = "analog" | "digital" | "portal" | "threeD";

/** A power-up token on the board: a kind (what it does) and where it sits. */
export type Powerup = {
  readonly kind: PowerupKind;
  readonly pos: Vec2;
};

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
   * When true the lethal walls are off and the board edge wraps: the head that
   * leaves one side re-enters the opposite side (the Pac-Man "portal" effect),
   * instead of dying. Toggled on by the 🌀 portal power-up. Default false — the
   * classic snake where leaving the board is fatal.
   */
  readonly edgeWrap: boolean;
  /**
   * When true the renderer draws the snake with real depth (raised, lit blocks
   * seen through a tilted camera). Toggled on by the 🧊 3D power-up. This is a
   * pure rendering flag — the kernel carries it but movement/collision ignore it,
   * so it cannot affect the deterministic simulation.
   */
  readonly threeD: boolean;
  /**
   * The power-up token on the board, or null once collected / not present. Each
   * token carries its `kind` (see `PowerupKind`); walking the head over it applies
   * that kind's effect. Power-ups are transient: they appear on a random cadence
   * and vanish after a short while, so this is null far more often than not.
   */
  readonly powerup: Powerup | null;
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
