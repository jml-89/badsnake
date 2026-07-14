import { initialState, tick } from "../core/game/snake";
import type { GameState } from "../core/game/types";
import type { IntentSource } from "../core/ports/input";
import { createBrowserClock } from "../adapters/clock/browser-clock";
import { createKeyboardInput } from "../adapters/input/keyboard";
import { createTouchInput } from "../adapters/input/touch";
import { createThreeRenderer } from "../adapters/render/three-renderer";
import { createHud } from "../adapters/hud/dom-hud";

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

// Two input devices — keyboard (desktop) and the on-screen D-pad/buttons
// (touch) — merge into one intent stream. The kernel never knows there was
// more than one device: it only ever sees the drained, device-agnostic
// intents. Adding a gamepad or gestures later is just another source here.
const keyboard = createKeyboardInput();
const touch = createTouchInput();
const input: IntentSource = {
  drain: () => keyboard.drain().concat(touch.drain()),
};

const renderer = createThreeRenderer(container, COLS, ROWS);
const hud = createHud();

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
  hud.update(state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
