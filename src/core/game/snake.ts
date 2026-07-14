import type { Direction, GameState, Intent, Vec2 } from "./types";
import { nextRng, seedRng } from "./rng";

const DELTAS: Record<Direction, Vec2> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const LEFT_OF: Record<Direction, Direction> = {
  north: "west",
  west: "south",
  south: "east",
  east: "north",
};

const RIGHT_OF: Record<Direction, Direction> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

function isReversal(a: Direction, b: Direction): boolean {
  return DELTAS[a].x === -DELTAS[b].x && DELTAS[a].y === -DELTAS[b].y;
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
  const base: GameState = {
    width,
    height,
    snake,
    heading: "east",
    food: { x: 0, y: 0 },
    phase: "playing",
    score: 0,
    tick: 0,
    rngState: seedRng(seed),
  };
  return placeFood(base);
}

/** Deterministically drops food onto a random empty cell. */
function placeFood(state: GameState): GameState {
  const occupied = new Set(state.snake.map((c) => c.y * state.width + c.x));
  const free: number[] = [];
  for (let i = 0; i < state.width * state.height; i++) {
    if (!occupied.has(i)) free.push(i);
  }
  if (free.length === 0) {
    return { ...state, phase: "dead" }; // board full — nowhere to grow
  }
  const { value, state: rngState } = nextRng(state.rngState);
  const cell = free[Math.floor(value * free.length)]!;
  const food: Vec2 = { x: cell % state.width, y: Math.floor(cell / state.width) };
  return { ...state, food, rngState };
}

/**
 * Reduce the buffered intents into a single heading for this tick. At most one
 * legal heading change is applied per tick, and 180° reversals are rejected —
 * together these kill the classic "reverse into yourself from one input" bug.
 */
function resolveHeading(current: Direction, intents: readonly Intent[]): Direction {
  for (const intent of intents) {
    let candidate: Direction | null = null;
    if (intent.kind === "steer") {
      candidate = intent.direction;
    } else if (intent.kind === "turn") {
      candidate = intent.turn === "left" ? LEFT_OF[current] : RIGHT_OF[current];
    }
    if (candidate !== null && !isReversal(candidate, current)) {
      return candidate; // first legal change wins
    }
  }
  return current;
}

/**
 * The one pure step: (state, intents, dt) -> state. Given the same inputs it
 * always returns the same output — no clock, no randomness beyond the seeded
 * state, no I/O.
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

  const heading = resolveHeading(state.heading, intents);
  const delta = DELTAS[heading];
  const head = state.snake[0]!;
  const nextHead: Vec2 = { x: head.x + delta.x, y: head.y + delta.y };

  // Walls are lethal (classic snake — no wrap).
  if (
    nextHead.x < 0 ||
    nextHead.x >= state.width ||
    nextHead.y < 0 ||
    nextHead.y >= state.height
  ) {
    return { ...state, heading, phase: "dead" };
  }

  const ate = nextHead.x === state.food.x && nextHead.y === state.food.y;

  // The tail cell is vacated unless we grow, so drop it before the self-collision
  // check — moving into the current tail is legal.
  const remaining = ate ? state.snake : state.snake.slice(0, -1);
  if (remaining.some((c) => c.x === nextHead.x && c.y === nextHead.y)) {
    return { ...state, heading, phase: "dead" };
  }

  const moved: GameState = {
    ...state,
    snake: [nextHead, ...remaining],
    heading,
    phase: "playing",
    tick: state.tick + 1,
    score: ate ? state.score + 1 : state.score,
  };

  return ate ? placeFood(moved) : moved;
}
