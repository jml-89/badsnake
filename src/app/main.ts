import { initialState, tick, SIM_DT_MS } from "../core/game/snake";
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

// Fixed-timestep loop on a single fine step (SIM_DT_MS). Movement speed lives
// inside the kernel now as a velocity (the difficulty curve), so the step stays
// constant while the snake still starts slow and quickens with every bite. The
// leftover accumulator becomes the render-time `alpha` for interpolation. The
// clamp prevents a catch-up spiral after the tab was hidden.
function frame(): void {
  const now = clock.now();
  accumulator = Math.min(accumulator + (now - last), 250);
  last = now;

  while (accumulator >= SIM_DT_MS) {
    state = tick(state, input.drain(), SIM_DT_MS);
    accumulator -= SIM_DT_MS;
  }

  renderer.render(state, accumulator / SIM_DT_MS);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
