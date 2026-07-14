import type { GameState, Intent, Vec2 } from "./types";
import { nextRng, seedRng } from "./rng";
import {
  DIRECTION_INDEX,
  EAST,
  QUARTER,
  isReversal,
  nearestCardinal,
  rotateBy,
  rotateToward,
  unitOf,
  wrap,
} from "./heading";

// --- Tunables -------------------------------------------------------------
// A heading is one of HEADINGS discrete angles; these are expressed in those
// units. See heading.ts.

/** Analog: how far a single relative `turn` intent nudges the heading. */
const TURN_STEP = 6;
/** Analog: the most a heading may rotate in one tick — the bounded turn rate. */
const MAX_TURN = 16;
/** Distance under which the head is treated as overlapping a cell. <1 so that
 *  orthogonally-adjacent cardinal cells (distance 1) never collide, while an
 *  exact overlap (distance 0) always does — keeping cardinal mode identical. */
const HIT_RADIUS = 0.5;

// --- Difficulty curve -----------------------------------------------------
// The snake starts slow and forgiving, then quickens with every bite: each food
// both grows the body (see the move step) and shortens the interval between
// ticks. Speed is a game *rule*, so it lives here as pure data — the composition
// root reads `tickIntervalMs(state)` to pace its loop; the kernel never touches a
// clock. All values are milliseconds per simulation tick.

/** Interval at score 0 — deliberately languid so the first moves are easy. */
const START_TICK_MS = 200;
/** The fastest the game gets; the curve clamps here so it stays playable. */
const MIN_TICK_MS = 75;
/** How much each food eaten shaves off the tick interval. */
const SPEEDUP_PER_FOOD_MS = 9;

/**
 * The current simulation cadence in ms, as a pure function of how much has been
 * eaten. Starts at START_TICK_MS and tightens by SPEEDUP_PER_FOOD_MS per food,
 * floored at MIN_TICK_MS. This is the difficulty curve; the run loop paces itself
 * by it instead of a constant.
 */
export function tickIntervalMs(state: GameState): number {
  return Math.max(MIN_TICK_MS, START_TICK_MS - state.score * SPEEDUP_PER_FOOD_MS);
}

// --- Power-up cadence (in ticks) ------------------------------------------
// Power-ups are not permanent fixtures: one appears after a random gap, lingers
// for a short window, then vanishes if not grabbed — the disappearance is what
// makes it urgent. Timing is measured in integer ticks (the deterministic
// timeline) and drawn from the seeded RNG, so it replays exactly.

/** How many ticks a power-up stays on the board before despawning. */
const POWERUP_TTL_TICKS = 40;
/** Shortest gap between one power-up leaving and the next arriving. */
const POWERUP_MIN_GAP_TICKS = 60;
/** Longest such gap. The actual gap is drawn uniformly in [MIN, MAX]. */
const POWERUP_MAX_GAP_TICKS = 140;

/** Draws a random spawn gap (in ticks) from the seeded RNG. */
function nextGap(rngState: number): { readonly gap: number; readonly rngState: number } {
  const { value, state } = nextRng(rngState);
  const span = POWERUP_MAX_GAP_TICKS - POWERUP_MIN_GAP_TICKS + 1;
  return { gap: POWERUP_MIN_GAP_TICKS + Math.floor(value * span), rngState: state };
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy); // sqrt is correctly-rounded → deterministic
}

export type NewGameOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
};

export function initialState(options: NewGameOptions = {}): GameState {
  const width = options.width ?? 20;
  const height = options.height ?? 20;
  const seed = options.seed ?? 1;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const snake: Vec2[] = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  // Schedule the first power-up a random gap out — the board starts clean so the
  // player eases in before the first urgent token appears.
  const { gap, rngState } = nextGap(seedRng(seed));
  const base: GameState = {
    width,
    height,
    snake,
    heading: EAST,
    mode: "cardinal",
    powerup: null,
    powerupExpiresAt: null,
    powerupNextAt: gap,
    food: { x: 0, y: 0 },
    phase: "playing",
    score: 0,
    tick: 0,
    rngState,
  };
  return placeFood(base);
}

/** All board cells not occupied by the snake, food, or power-up. */
function freeCells(state: GameState): number[] {
  const occupied = new Set<number>();
  // Round to the containing cell — analog segments can be sub-cell floats.
  for (const c of state.snake) occupied.add(Math.round(c.y) * state.width + Math.round(c.x));
  occupied.add(state.food.y * state.width + state.food.x);
  if (state.powerup !== null) occupied.add(state.powerup.y * state.width + state.powerup.x);
  const free: number[] = [];
  for (let i = 0; i < state.width * state.height; i++) {
    if (!occupied.has(i)) free.push(i);
  }
  return free;
}

/** Deterministically drops food onto a random empty cell. */
function placeFood(state: GameState): GameState {
  const free = freeCells(state);
  if (free.length === 0) {
    return { ...state, phase: "dead" }; // board full — nowhere to grow
  }
  const { value, state: rngState } = nextRng(state.rngState);
  const cell = free[Math.floor(value * free.length)]!;
  const food: Vec2 = { x: cell % state.width, y: Math.floor(cell / state.width) };
  return { ...state, food, rngState };
}

/** Deterministically drops the joystick power-up onto a random empty cell. */
function placePowerup(state: GameState): GameState {
  const free = freeCells(state);
  if (free.length === 0) return state;
  const { value, state: rngState } = nextRng(state.rngState);
  const cell = free[Math.floor(value * free.length)]!;
  const powerup: Vec2 = { x: cell % state.width, y: Math.floor(cell / state.width) };
  return { ...state, powerup, rngState };
}

/**
 * Advances the power-up lifecycle for the tick just computed (so `state.tick`
 * already reflects the move). The single place that owns the appear → linger →
 * vanish cycle:
 *
 * - `collected` — the head grabbed it this tick: clear the token and roll the
 *   next random gap.
 * - active and past its expiry — it timed out unclaimed: clear it and reschedule.
 * - none present and the scheduled spawn tick has arrived — drop a fresh token
 *   and start its short despawn countdown.
 */
function advancePowerup(state: GameState, collected: boolean): GameState {
  if (collected) {
    const { gap, rngState } = nextGap(state.rngState);
    return { ...state, powerup: null, powerupExpiresAt: null, powerupNextAt: state.tick + gap, rngState };
  }
  if (state.powerup !== null) {
    if (state.powerupExpiresAt !== null && state.tick >= state.powerupExpiresAt) {
      const { gap, rngState } = nextGap(state.rngState);
      return { ...state, powerup: null, powerupExpiresAt: null, powerupNextAt: state.tick + gap, rngState };
    }
    return state;
  }
  if (state.tick >= state.powerupNextAt) {
    const spawned = placePowerup(state);
    if (spawned.powerup === null) return state; // board full — try again next tick
    return { ...spawned, powerupExpiresAt: state.tick + POWERUP_TTL_TICKS };
  }
  return state;
}

/**
 * Cardinal steering: the original rules, now over heading indices. At most one
 * legal heading change per tick, and 180° reversals are rejected — together they
 * kill the "reverse into yourself from one input" bug. `steer` is absolute;
 * `turn` is a 90° relative step.
 */
function steerCardinal(heading: number, intents: readonly Intent[]): number {
  for (const intent of intents) {
    let candidate: number | null = null;
    if (intent.kind === "steer") {
      candidate = DIRECTION_INDEX[intent.direction];
    } else if (intent.kind === "steerAngle") {
      candidate = nearestCardinal(intent.index); // an analog stick, snapped to a cardinal
    } else if (intent.kind === "turn") {
      candidate = rotateBy(heading, intent.turn === "left" ? -QUARTER : QUARTER);
    }
    if (candidate !== null && !isReversal(candidate, heading)) {
      return candidate; // first legal change wins
    }
  }
  return heading;
}

/**
 * Analog steering: every heading change is capped at MAX_TURN per tick — the
 * continuous generalization of the no-180 rule (you simply cannot spin around in
 * one tick). `turn` intents accumulate (so *holding* a key sweeps the heading
 * while a *tap* nudges it); an absolute `steer` rotates toward that cardinal,
 * also bounded. Both paths preserve the per-tick turn-rate cap.
 */
function steerAnalog(heading: number, intents: readonly Intent[]): number {
  let target: number | null = null;
  let net = 0;
  for (const intent of intents) {
    if (intent.kind === "steer") {
      target = DIRECTION_INDEX[intent.direction];
    } else if (intent.kind === "steerAngle") {
      target = wrap(intent.index); // full-resolution pointing — the joystick's home turf
    } else if (intent.kind === "turn") {
      net += intent.turn === "left" ? -TURN_STEP : TURN_STEP;
    }
  }
  let next = heading;
  if (target !== null) next = rotateToward(next, target, MAX_TURN);
  if (net !== 0) next = rotateBy(next, Math.max(-MAX_TURN, Math.min(MAX_TURN, net)));
  return next;
}

function resolveHeading(state: GameState, intents: readonly Intent[]): number {
  return state.mode === "analog"
    ? steerAnalog(state.heading, intents)
    : steerCardinal(state.heading, intents);
}

/**
 * The one pure step: (state, intents, dt) -> state. Given the same inputs it
 * always returns the same output — no clock, no randomness beyond the seeded
 * state, no I/O, and no runtime trig (headings index a frozen unit table).
 */
export function tick(state: GameState, intents: readonly Intent[], _dtMs: number): GameState {
  // Control intents apply regardless of phase.
  if (intents.some((i) => i.kind === "restart")) {
    return initialState({ width: state.width, height: state.height, seed: state.rngState });
  }

  if (state.phase === "dead") {
    return state;
  }

  let phase = state.phase;
  for (const intent of intents) {
    if (intent.kind === "pause") {
      phase = phase === "paused" ? "playing" : "paused";
    }
  }
  if (phase === "paused") {
    return { ...state, phase };
  }

  const heading = resolveHeading(state, intents);
  const step = unitOf(heading);
  const head = state.snake[0]!;
  const nextHead: Vec2 = { x: head.x + step.x, y: head.y + step.y };

  // Walls are lethal (classic snake — no wrap). Cells span [0, width) x
  // [0, height); a float head is out the moment it leaves that box.
  if (
    nextHead.x < 0 ||
    nextHead.x >= state.width ||
    nextHead.y < 0 ||
    nextHead.y >= state.height
  ) {
    return { ...state, heading, phase: "dead" };
  }

  const ate = dist(nextHead, state.food) < HIT_RADIUS;

  // The tail cell is vacated unless we grow, so drop it before the self-collision
  // check — moving into the current tail is legal. Collision is now distance-based
  // (HIT_RADIUS), which reduces to exact-cell overlap in cardinal mode.
  const remaining = ate ? state.snake : state.snake.slice(0, -1);
  if (remaining.some((c) => dist(c, nextHead) < HIT_RADIUS)) {
    return { ...state, heading, phase: "dead" };
  }

  // Collect the joystick: flips control to analog for the rest of the run.
  const gotPowerup = state.powerup !== null && dist(nextHead, state.powerup) < HIT_RADIUS;

  const moved: GameState = {
    ...state,
    snake: [nextHead, ...remaining],
    heading,
    mode: gotPowerup ? "analog" : state.mode,
    powerup: gotPowerup ? null : state.powerup,
    phase: "playing",
    tick: state.tick + 1,
    score: ate ? state.score + 1 : state.score,
  };

  // Run the power-up clock on the post-move tick: grab, expiry, or timed spawn.
  const withPowerup = advancePowerup(moved, gotPowerup);

  return ate ? placeFood(withPowerup) : withPowerup;
}
