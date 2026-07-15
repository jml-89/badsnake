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

// --- The simulation timeline ----------------------------------------------
// There is ONE authoritative clock: a fixed-timestep integer tick. The
// composition root advances the world by SIM_DT_MS of simulated time per tick
// (see main.ts) and never anything else — render interpolation and power-up
// cadence are derived from this single timeline, so the game stays a
// deterministic fold. The step is deliberately fine (well under a cell of
// travel) so steering and input are serviced many times per cell.

/** Milliseconds of simulated time advanced per fixed tick. */
export const SIM_DT_MS = 50;

// --- Steering tunables -----------------------------------------------------
// A heading is one of HEADINGS discrete angles; these are expressed in those
// units, per tick. See heading.ts.

/** Analog: how far a single relative `turn` intent nudges the heading. */
const TURN_STEP = 6;
/** Analog: the most a heading may rotate in one tick — the bounded turn rate. */
const MAX_TURN = 16;
/** Distance under which two points are treated as overlapping. <1 so that
 *  orthogonally-adjacent cardinal cells (distance 1) never collide, while an
 *  exact overlap (distance 0) always does — keeping cardinal mode identical. */
const HIT_RADIUS = 0.5;
/** Arc length behind the head that self-collision ignores — the "neck". The
 *  node(s) immediately trailing the head are always close; only body further
 *  along the path can be a genuine self-hit. */
const NECK = 1.2;

// --- Difficulty curve (movement speed) ------------------------------------
// The snake starts slow and forgiving, then quickens with every bite. Speed is a
// game *rule*, so it lives here as pure data. It used to be encoded as the tick
// interval; now the tick is fixed and speed is a velocity — the time to cross
// one cell, from which cells-per-ms falls out. Same feel, decoupled from the
// timestep.

/** Time to cross one cell at score 0 — deliberately languid to ease players in. */
const START_INTERVAL_MS = 200;
/** The shortest cell-crossing time; the curve clamps here so it stays playable. */
const MIN_INTERVAL_MS = 75;
/** How much each food eaten shaves off the cell-crossing time. */
const SPEEDUP_PER_FOOD_MS = 9;

/**
 * Milliseconds to cross one cell at the given score: starts at START_INTERVAL_MS
 * and tightens by SPEEDUP_PER_FOOD_MS per food, floored at MIN_INTERVAL_MS. This
 * is the difficulty curve; movement reads it as a speed (see `speedCellsPerMs`).
 */
export function cellIntervalMs(score: number): number {
  return Math.max(MIN_INTERVAL_MS, START_INTERVAL_MS - score * SPEEDUP_PER_FOOD_MS);
}

/** Current movement speed in cells per millisecond — the inverse of the curve. */
function speedCellsPerMs(score: number): number {
  return 1 / cellIntervalMs(score);
}

// --- Power-up cadence (in milliseconds) -----------------------------------
// Power-ups are not permanent fixtures: one appears after a random gap, lingers
// for a short window, then vanishes if not grabbed — the disappearance is what
// makes it urgent. Timing is measured against `clockMs` (accumulated sim time)
// and drawn from the seeded RNG, so it replays exactly regardless of timestep.

/** How long a power-up stays on the board before despawning. */
const POWERUP_TTL_MS = 6000;
/** Shortest gap between one power-up leaving and the next arriving. */
const POWERUP_MIN_GAP_MS = 9000;
/** Longest such gap. The actual gap is drawn uniformly in [MIN, MAX]. */
const POWERUP_MAX_GAP_MS = 21000;

/** Draws a random spawn gap (in ms) from the seeded RNG. */
function nextGap(rngState: number): { readonly gap: number; readonly rngState: number } {
  const { value, state } = nextRng(rngState);
  const span = POWERUP_MAX_GAP_MS - POWERUP_MIN_GAP_MS;
  return { gap: POWERUP_MIN_GAP_MS + Math.floor(value * (span + 1)), rngState: state };
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
    pendingHeading: null,
    cellProgress: 0,
    lengthCells: snake.length,
    clockMs: 0,
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
  // Round to the containing cell — analog nodes can be sub-cell floats.
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
 * Advances the power-up lifecycle against the accumulated sim clock (`clockMs`,
 * already updated for this tick). The single place that owns the appear →
 * linger → vanish cycle:
 *
 * - `collected` — the head grabbed it this tick: clear the token and roll the
 *   next random gap.
 * - active and past its expiry — it timed out unclaimed: clear it and reschedule.
 * - none present and the scheduled spawn time has arrived — drop a fresh token
 *   and start its short despawn countdown.
 */
function advancePowerup(state: GameState, collected: boolean): GameState {
  if (collected) {
    const { gap, rngState } = nextGap(state.rngState);
    return { ...state, powerup: null, powerupExpiresAt: null, powerupNextAt: state.clockMs + gap, rngState };
  }
  if (state.powerup !== null) {
    if (state.powerupExpiresAt !== null && state.clockMs >= state.powerupExpiresAt) {
      const { gap, rngState } = nextGap(state.rngState);
      return { ...state, powerup: null, powerupExpiresAt: null, powerupNextAt: state.clockMs + gap, rngState };
    }
    return state;
  }
  if (state.clockMs >= state.powerupNextAt) {
    const spawned = placePowerup(state);
    if (spawned.powerup === null) return state; // board full — try again next tick
    return { ...spawned, powerupExpiresAt: state.clockMs + POWERUP_TTL_MS };
  }
  return state;
}

/**
 * Cardinal steering, buffered. Picks the first legal turn in this tick's intents
 * — absolute `steer`, an analog-stick `steerAngle` snapped to a cardinal, or a
 * 90° relative `turn` — rejecting 180° reversals of the committed heading. The
 * chosen turn latches into `pendingHeading` and is consumed at the next cell
 * commit, so mashing keys between commits still yields exactly one legal turn
 * per cell (the classic no-reverse-into-yourself rule, now timestep-independent).
 */
function bufferCardinalTurn(state: GameState, intents: readonly Intent[]): number | null {
  // A turn is already latched for this cell — first legal wins, ignore the rest.
  if (state.pendingHeading !== null) return state.pendingHeading;
  for (const intent of intents) {
    let candidate: number | null = null;
    if (intent.kind === "steer") {
      candidate = DIRECTION_INDEX[intent.direction];
    } else if (intent.kind === "steerAngle") {
      candidate = nearestCardinal(intent.index);
    } else if (intent.kind === "turn") {
      candidate = rotateBy(state.heading, intent.turn === "left" ? -QUARTER : QUARTER);
    }
    if (candidate !== null && candidate !== state.heading && !isReversal(candidate, state.heading)) {
      return candidate; // first legal change latches
    }
  }
  return null;
}

/**
 * Analog steering: every heading change is capped at MAX_TURN per tick — the
 * continuous generalization of the no-180 rule (you cannot spin around in one
 * tick). `turn` intents accumulate (so *holding* a key sweeps the heading while
 * a *tap* nudges it); an absolute `steer`/`steerAngle` rotates toward that
 * target, also bounded. Runs every fine tick, so steering is responsive.
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

/**
 * The uniform collision system. Given the head point and the body nodes behind
 * it (head-first, `nodes[0]` is the head itself), reports whether the head
 * overlaps any body node past the neck. Distance-based over the continuous
 * polyline, so it is identical for cardinal and analog — and is exactly the test
 * a future moving hazard (a falling bullet) would run against the same body.
 */
function selfHit(head: Vec2, nodes: readonly Vec2[]): boolean {
  let arc = 0;
  for (let k = 1; k < nodes.length; k++) {
    arc += dist(nodes[k - 1]!, nodes[k]!);
    if (arc < NECK) continue; // still in the neck — never a real self-hit
    if (dist(head, nodes[k]!) < HIT_RADIUS) return true;
  }
  return false;
}

/** True when a point has left the board — walls are lethal (classic snake). */
function outOfBounds(p: Vec2, width: number, height: number): boolean {
  return p.x < 0 || p.x >= width || p.y < 0 || p.y >= height;
}

/** What a movement strategy reports back to the shared epilogue. */
type Move = {
  readonly state: GameState;
  readonly ate: boolean;
  readonly collected: boolean;
};

/**
 * Cardinal movement: quantized. Distance accrues into `cellProgress` at the
 * current speed; each time it crosses a whole cell the head commits exactly one
 * integer step in the (buffered) heading — so the snap is exact no matter the
 * timestep. Between commits nothing moves; the renderer holds the crisp grid.
 */
function moveCardinal(state: GameState, intents: readonly Intent[], dt: number): Move {
  const pending = bufferCardinalTurn(state, intents);

  let snake = state.snake;
  let heading = state.heading;
  let pendingHeading = pending;
  let progress = state.cellProgress + speedCellsPerMs(state.score) * dt;
  let lengthCells = state.lengthCells;
  let score = state.score;
  let mode = state.mode;
  let powerup = state.powerup;
  let ate = false;
  let collected = false;
  let dead = false;

  // Usually at most one commit per tick; a lagged frame may commit a few.
  while (progress >= 1 && !dead) {
    progress -= 1;
    if (pendingHeading !== null) {
      heading = pendingHeading;
      pendingHeading = null;
    }
    const head = snake[0]!;
    const step = unitOf(heading);
    const nextHead: Vec2 = { x: head.x + step.x, y: head.y + step.y };

    if (outOfBounds(nextHead, state.width, state.height)) {
      dead = true;
      break;
    }

    const bite = dist(nextHead, state.food) < HIT_RADIUS;
    // Vacate the tail before the self-check unless we grow — moving into the
    // current tail cell is legal.
    const grown = [nextHead, ...snake];
    const trimmed = bite ? grown : grown.slice(0, lengthCells);
    if (selfHit(nextHead, trimmed)) {
      dead = true; // freeze at the last good position (do not commit the move)
      break;
    }
    if (powerup !== null && dist(nextHead, powerup) < HIT_RADIUS) {
      collected = true;
      mode = "analog";
      powerup = null;
    }
    if (bite) {
      lengthCells += 1;
      score += 1;
      ate = true;
    }
    snake = trimmed;
  }

  const next: GameState = {
    ...state,
    snake,
    heading,
    pendingHeading,
    cellProgress: dead ? state.cellProgress : progress,
    lengthCells,
    score,
    mode,
    powerup,
    phase: dead ? "dead" : "playing",
  };
  return { state: next, ate, collected };
}

/**
 * Analog movement: continuous. The head integrates velocity·dt every tick along
 * a freely-rotating heading. A trailing body node is laid down each time the
 * head has travelled a full cell from the last one, keeping the body a polyline
 * at ~1-cell arc spacing — so the same distance-based collision and renderer
 * work unchanged, while the motion itself is smooth.
 */
function moveAnalog(state: GameState, intents: readonly Intent[], dt: number): Move {
  const heading = steerAnalog(state.heading, intents);
  const step = unitOf(heading);
  const speed = speedCellsPerMs(state.score) * dt;
  const head = state.snake[0]!;
  const nextHead: Vec2 = { x: head.x + step.x * speed, y: head.y + step.y * speed };

  if (outOfBounds(nextHead, state.width, state.height)) {
    return { state: { ...state, heading, phase: "dead" }, ate: false, collected: false };
  }

  // Lay a fresh node once the head has opened a full cell of gap to the last one.
  const anchor = state.snake[1] ?? head;
  const gap = dist(nextHead, anchor);
  let nodes: Vec2[];
  if (gap >= 1) {
    // Place the new node exactly one cell from the anchor toward the head, so
    // spacing stays ~1 cell even when a tick overshoots.
    const inv = 1 / gap;
    const commit: Vec2 = {
      x: anchor.x + (nextHead.x - anchor.x) * inv,
      y: anchor.y + (nextHead.y - anchor.y) * inv,
    };
    nodes = [nextHead, commit, ...state.snake.slice(1)];
  } else {
    nodes = [nextHead, ...state.snake.slice(1)];
  }

  const bite = dist(nextHead, state.food) < HIT_RADIUS;
  const lengthCells = bite ? state.lengthCells + 1 : state.lengthCells;
  // Keep at most one lead node ahead of `lengthCells` committed nodes.
  const trimmed = nodes.slice(0, lengthCells + 1);

  if (selfHit(nextHead, trimmed)) {
    // Freeze at the last good position (do not commit the move).
    return { state: { ...state, heading, phase: "dead" }, ate: false, collected: false };
  }

  let mode = state.mode;
  let powerup = state.powerup;
  let collected = false;
  if (powerup !== null && dist(nextHead, powerup) < HIT_RADIUS) {
    collected = true;
    mode = "analog";
    powerup = null;
  }

  const next: GameState = {
    ...state,
    snake: trimmed,
    heading,
    lengthCells,
    score: bite ? state.score + 1 : state.score,
    mode,
    powerup,
    phase: "playing",
  };
  return { state: next, ate: bite, collected };
}

/**
 * The one pure step: (state, intents, dt) -> state. Given the same inputs it
 * always returns the same output — no clock, no randomness beyond the seeded
 * state, no I/O, and no runtime trig (headings index a frozen unit table).
 *
 * Structured as an ordered pipeline: control intents → the mode's movement
 * strategy (which runs the shared collision system) → the shared epilogue
 * (advance the clock, run the power-up lifecycle, replace eaten food).
 */
export function tick(state: GameState, intents: readonly Intent[], dtMs: number): GameState {
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
    return { ...state, phase }; // frozen: the clock does not advance while paused
  }

  const move = state.mode === "analog"
    ? moveAnalog(state, intents, dtMs)
    : moveCardinal(state, intents, dtMs);

  if (move.state.phase === "dead") {
    return move.state;
  }

  // Shared epilogue on the post-move world: advance the clock, run the power-up
  // lifecycle against it, and drop new food when something was eaten.
  const advanced: GameState = {
    ...move.state,
    tick: state.tick + 1,
    clockMs: state.clockMs + dtMs,
  };
  const withPowerup = advancePowerup(advanced, move.collected);
  return move.ate ? placeFood(withPowerup) : withPowerup;
}
