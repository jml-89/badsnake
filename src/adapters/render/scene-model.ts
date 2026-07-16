// The renderer's brain, extracted from its hands. This module decides *what* the
// frame should contain — which camera, where every mesh sits, which power-up
// glyph, whether the walls read as lethal — and returns it as plain data. It
// imports no three.js and touches no GPU, so the whole composition is unit-
// testable in Node with zero browser (see scene-model.test.ts).
//
// This is the "renderer is a sink" boundary taken one step further: the GL sink
// (three-renderer.ts) becomes a thin translator that places exactly what this
// hands it, and the interesting decisions live here where they can be checked.
//
// It is pure but it is NOT the kernel — it may read render-time `alpha` and hold
// no game rules. Presentation specifics that need the GPU (emoji textures, hex
// colours, geometry) stay in the sink; this only names them semantically
// (a power-up `kind`, `wallsLethal`).

import type { GameState, PowerupKind, Vec2 } from "../../core/game/types";
import { axisDelta, torusDist, wrapAxis } from "../../core/game/torus";

export type Camera = "flat" | "3d";

export interface RenderToken {
  readonly kind: PowerupKind;
  readonly pos: Vec2;
}

/**
 * Everything the GL sink needs to draw one frame, as plain data:
 *
 * - `camera`      — which view to render through (the 3D power-up tilts it).
 * - `wallsLethal` — false once the portal power-up turns the edge into a wrap;
 *   the sink recolours the border on this (red → cyan). Kept semantic (a bool),
 *   not a hex, so tests assert intent rather than a colour code.
 * - `snake`       — body nodes, head first, already interpolated for this frame.
 * - `food`        — the food cell.
 * - `token`       — the power-up on the board, or null.
 */
export interface SceneModel {
  readonly camera: Camera;
  readonly wallsLethal: boolean;
  readonly snake: readonly Vec2[];
  readonly food: Vec2;
  readonly token: RenderToken | null;
}

// --- Interpolation pair ----------------------------------------------------
// Analog motion is drawn `alpha` of the way from the previous simulation tick to
// the current one, turning discrete fixed-step advances into continuous glide.
// That needs the previous frame's snake as well as this one, so the sink carries
// this small pair across frames — but the *rules* for advancing it (and the
// head interpolation + arc-length body-follow below) are pure and live here.

export interface InterpState {
  readonly prev: readonly Vec2[];
  readonly cur: readonly Vec2[];
  readonly tick: number;
  readonly initialized: boolean;
}

export const initialInterp: InterpState = { prev: [], cur: [], tick: -1, initialized: false };

/**
 * Advances the (prev, cur) interpolation pair for a new game state. We glide only
 * across a normal single-tick advance while playing in analog mode; on the first
 * frame, a restart, a pause, death, a mode flip, or a multi-tick catch-up (after
 * a hidden tab) the body snaps instead — prev and cur collapse to the same snake.
 */
export function advanceInterp(interp: InterpState, state: GameState): InterpState {
  const smooth = state.mode === "analog";
  if (!interp.initialized || state.phase !== "playing" || !smooth) {
    return { prev: state.snake, cur: state.snake, tick: state.tick, initialized: true };
  }
  if (state.tick === interp.tick + 1) {
    return { prev: interp.cur, cur: state.snake, tick: state.tick, initialized: true };
  }
  if (state.tick !== interp.tick) {
    // Reset or multi-tick jump: snap, don't glide across the gap.
    return { prev: state.snake, cur: state.snake, tick: state.tick, initialized: true };
  }
  return interp; // same tick, still gliding — keep the pair, let alpha advance
}

/** Nominal arc-length between body nodes — matches moveAnalog's 1-cell commit spacing. */
const NODE_SPACING = 1;

/**
 * Interpolates from `a` to `b` by fraction `t` along the *shortest* path, folding
 * the result back onto the board. Across a portal wrap seam this slides off one
 * edge and re-enters the other (`axisDelta` picks the short way, `wrapAxis` folds)
 * instead of sweeping the long way across the board.
 */
function interpAcross(a: Vec2, b: Vec2, t: number, width: number, height: number, edgeWrap: boolean): Vec2 {
  return {
    x: wrapAxis(a.x + axisDelta(a.x, b.x, width, edgeWrap) * t, width),
    y: wrapAxis(a.y + axisDelta(a.y, b.y, height, edgeWrap) * t, height),
  };
}

/**
 * Walks `target` cells of arc-length back along the polyline `trail` (head first)
 * and returns the point there — each segment measured and interpolated the short
 * way when the edge wraps, so the body follows the head cleanly across a portal
 * seam. Clamps to the tail when the trail is shorter than `target`.
 */
function sampleAlong(trail: readonly Vec2[], target: number, width: number, height: number, edgeWrap: boolean): Vec2 {
  let remaining = target;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!;
    const b = trail[i]!;
    const seg = torusDist(a, b, width, height, edgeWrap);
    if (remaining <= seg) {
      return interpAcross(a, b, seg === 0 ? 0 : remaining / seg, width, height, edgeWrap);
    }
    remaining -= seg;
  }
  const tail = trail[trail.length - 1]!;
  return { x: tail.x, y: tail.y };
}

/**
 * Composes the frame. `interp` is the pair from `advanceInterp`; `alpha` is the
 * render-time fraction in [0,1] toward the next tick.
 *
 * Cardinal — and any snapped discontinuity (first frame, restart, death, mode
 * flip, hidden-tab catch-up, where `advanceInterp` collapses prev==cur) — draws
 * the committed nodes exactly; the crisp grid snap is the point of those frames.
 *
 * Analog glides. The head is a genuinely continuous quantity (moveAnalog
 * re-integrates it every tick), so it interpolates directly along the shortest
 * path. The body nodes are different: they are discrete ~1-cell samples of the
 * head's trail that the kernel only *lays down* and never moves until they are
 * trimmed, so interpolating them by array index freezes them between commits and
 * jumps them a whole cell each time a commit renumbers the array — visible
 * stepping. Instead we lay the body out afresh each frame at a fixed arc-length
 * behind the interpolated head, sampled along that same trail, so it flows
 * continuously along the path independent of the commit cadence — and, because
 * the sampling is min-image, flows smoothly across the portal seam too.
 */
export function composeScene(state: GameState, interp: InterpState, alpha: number): SceneModel {
  const smooth = state.mode === "analog";
  const { prev, cur } = interp;
  const { width, height, edgeWrap } = state;
  // advanceInterp hands back the *same* array for prev and cur on a snap frame.
  const snapping = prev === cur;

  let snake: Vec2[];
  if (!smooth || snapping || cur.length === 0) {
    snake = cur.map((n) => ({ x: n.x, y: n.y }));
  } else {
    const t = Math.max(0, Math.min(1, alpha));
    const head = interpAcross(prev[0] ?? cur[0]!, cur[0]!, t, width, height, edgeWrap);
    const trail = [head, ...cur.slice(1)];
    snake = [head];
    for (let k = 1; k < cur.length; k++) {
      snake.push(sampleAlong(trail, k * NODE_SPACING, width, height, edgeWrap));
    }
  }

  return {
    camera: state.threeD ? "3d" : "flat",
    wallsLethal: !state.edgeWrap,
    snake,
    food: state.food,
    token: state.powerup === null ? null : { kind: state.powerup.kind, pos: state.powerup.pos },
  };
}
