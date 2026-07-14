import { initialState, tick, tickIntervalMs } from "../core/game/snake";
import type { GameState } from "../core/game/types";
import { createBrowserClock } from "../adapters/clock/browser-clock";
import { createKeyboardInput } from "../adapters/input/keyboard";
import { createTouchInput } from "../adapters/input/touch";
import { mergeInputs } from "../adapters/input/merge";
import { createThreeRenderer } from "../adapters/render/three-renderer";

// --- Composition root: the only place that touches both sides and owns real
// time. It constructs the impure adapters, injects them, and runs the loop. ---

const COLS = 20;
const ROWS = 20;
const SEED = 1; // fixed for now: deterministic first game

const container = document.getElementById("app");
if (container === null) {
  throw new Error("missing #app container");
}

const clock = createBrowserClock();
// Two devices, one intent stream: keyboard everywhere, on-screen joystick +
// buttons on touch devices (the touch adapter mounts nothing on desktop).
const input = mergeInputs([createKeyboardInput(), createTouchInput()]);
const renderer = createThreeRenderer(container, COLS, ROWS);

let state: GameState = initialState({ width: COLS, height: ROWS, seed: SEED });
let accumulator = 0;
let last = clock.now();

// Fixed-timestep loop, but the step is the difficulty curve: `tickIntervalMs`
// shrinks as the score climbs, so the same loop runs slow-and-easy at the start
// and quickens with every bite. The step is re-read each iteration so a food
// eaten mid-frame speeds up the very next tick. The clamp prevents a catch-up
// spiral after the tab was hidden.
function frame(): void {
  const now = clock.now();
  accumulator = Math.min(accumulator + (now - last), 250);
  last = now;

  let step = tickIntervalMs(state);
  while (accumulator >= step) {
    state = tick(state, input.drain(), step);
    accumulator -= step;
    step = tickIntervalMs(state);
  }

  renderer.render(state, accumulator / step);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
