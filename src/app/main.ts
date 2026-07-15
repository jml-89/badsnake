import { initialState, tick, SIM_DT_MS } from "../core/game/snake";
import type { GameState, PowerupKind, Vec2 } from "../core/game/types";
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

/**
 * Optional debug/demo overrides read from the URL query, e.g.
 * `?3d=1&portal=1&powerup=analog&mode=analog&seed=7`. This is a composition-root
 * affordance — it only pre-seeds the initial state so a specific power-up effect
 * can be viewed (or screenshotted headlessly) without playing up to it. It does
 * not touch the kernel's purity: it just chooses different initial data.
 */
function applyDemoOverrides(base: GameState): GameState {
  const q = new URLSearchParams(window.location.search);
  let s = base;
  if (q.get("mode") === "analog") s = { ...s, mode: "analog" };
  if (q.get("portal") === "1") s = { ...s, edgeWrap: true };
  if (q.get("3d") === "1") s = { ...s, threeD: true };
  const kind = q.get("powerup") as PowerupKind | null;
  if (kind !== null && ["analog", "digital", "portal", "threeD"].includes(kind)) {
    // Off the snake's initial eastward row so it lingers for inspection.
    const head = s.snake[0]!;
    const pos: Vec2 = { x: Math.round(head.x), y: Math.max(0, Math.round(head.y) - 5) };
    s = { ...s, powerup: { kind, pos } };
  }
  return s;
}

const clock = createBrowserClock();
// Two devices, one intent stream: keyboard everywhere, on-screen joystick +
// buttons on touch devices (the touch adapter mounts nothing on desktop).
const input = mergeInputs([createKeyboardInput(), createTouchInput()]);
const renderer = createThreeRenderer(container, COLS, ROWS);

const seedParam = new URLSearchParams(window.location.search).get("seed");
const seed = seedParam !== null ? Number(seedParam) >>> 0 : SEED;
let state: GameState = applyDemoOverrides(initialState({ width: COLS, height: ROWS, seed }));
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
