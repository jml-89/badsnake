import { initialState, tick, SIM_DT_MS } from "../core/game/snake";
import type { GameState, PowerupKind, Vec2 } from "../core/game/types";
import { createBrowserClock } from "../adapters/clock/browser-clock";
import { createKeyboardInput } from "../adapters/input/keyboard";
import { createTouchInput } from "../adapters/input/touch";
import { mergeInputs } from "../adapters/input/merge";
import { createThreeRenderer } from "../adapters/render/three-renderer";
import type { Camera3DStyle } from "../adapters/render/three-renderer";
import { mountDebugMenu } from "../adapters/debug/debug-menu";

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
  // Grow the snake to a target size/speed up front (`?grow=N` eats N pellets'
  // worth): handy for landing straight in a fast, long-snake game to test.
  const grow = Number(q.get("grow"));
  if (Number.isFinite(grow) && grow > 0) {
    s = { ...s, lengthCells: s.lengthCells + grow, score: s.score + grow };
  }
  return s;
}

/** The 3D camera pose to build the renderer with (`?cam3d=low|high|ortho`). */
function cameraOverride(): Camera3DStyle | undefined {
  const cam = new URLSearchParams(window.location.search).get("cam3d");
  return cam === "low" || cam === "high" || cam === "ortho" ? cam : undefined;
}

const clock = createBrowserClock();
// Two devices, one intent stream: keyboard everywhere, on-screen joystick +
// buttons on touch devices (the touch adapter mounts nothing on desktop).
const input = mergeInputs([createKeyboardInput(), createTouchInput()]);
const cam3d = cameraOverride();
const renderer = createThreeRenderer(container, COLS, ROWS, cam3d ? { camera3d: cam3d } : {});

const seedParam = new URLSearchParams(window.location.search).get("seed");
const seed = seedParam !== null ? Number(seedParam) >>> 0 : SEED;
let state: GameState = applyDemoOverrides(initialState({ width: COLS, height: ROWS, seed }));
let accumulator = 0;
let last = clock.now();

// Opt-in QA affordance (`?debug=1`): a small menu to grant power-ups, grow the
// snake, and flip the 3D camera live — the "expose the wiring, compose later"
// stance. It reads and rewrites the live `state` through these two closures;
// nothing is composed into the default product unless the flag is present.
if (new URLSearchParams(window.location.search).get("debug") === "1") {
  mountDebugMenu(document.body, {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    setCamera3DStyle: (style) => renderer.setCamera3DStyle(style),
  });
}

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
