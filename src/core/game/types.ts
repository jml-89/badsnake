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

export type GameState = {
  readonly width: number;
  readonly height: number;
  /** Body cells, head first. */
  readonly snake: readonly Vec2[];
  readonly heading: Direction;
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
