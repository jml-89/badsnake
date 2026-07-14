import { initialState, tick } from "../core/game/snake";
import type { GameState } from "../core/game/types";
import { createBrowserClock } from "../adapters/clock/browser-clock";
import { createKeyboardInput } from "../adapters/input/keyboard";
import { createThreeRenderer } from "../adapters/render/three-renderer";

// --- Composition root: the only place that touches both sides and owns real
// time. It constructs the impure adapters, injects them, and runs the loop. ---

const COLS = 20;
const ROWS = 20;
const TICK_MS = 120; // simulation cadence — the game's speed
const SEED = 1; // fixed for now: deterministic first game

const container = document.getElementById("app");
if (container === null) {
  throw new Error("missing #app container");
}

const clock = createBrowserClock();
const input = createKeyboardInput();
const renderer = createThreeRenderer(container, COLS, ROWS);

let state: GameState = initialState({ width: COLS, height: ROWS, seed: SEED });
let accumulator = 0;
let last = clock.now();

// Fixed-timestep loop: simulation advances in whole TICK_MS steps regardless of
// display refresh rate; render runs every frame. The clamp prevents a catch-up
// spiral after the tab was hidden.
function frame(): void {
  const now = clock.now();
  accumulator = Math.min(accumulator + (now - last), 250);
  last = now;

  while (accumulator >= TICK_MS) {
    state = tick(state, input.drain(), TICK_MS);
    accumulator -= TICK_MS;
  }

  renderer.render(state, accumulator / TICK_MS);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
