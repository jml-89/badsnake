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
import { axisDelta, wrapAxis } from "../../core/game/torus";

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
// per-node lerp/snap below) are pure and live here.

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

/**
 * Composes the frame. `interp` is the pair from `advanceInterp`; `alpha` is the
 * render-time fraction in [0,1] toward the next tick. Cardinal draws raw (its
 * exact grid snap is the point of the mode); analog glides each node from prev to
 * cur along the *shortest* path — so across a portal wrap seam a node slides off
 * one edge and re-enters the other (`axisDelta` + `wrapAxis`) instead of smearing
 * the long way back across the board, and head and body cross by the identical
 * rule. This is exact rather than a magnitude guess because `advanceInterp`
 * collapses prev==cur on every non-single-tick jump (restart, death, mode flip,
 * hidden-tab catch-up), so when we glide the two frames are one tick apart and
 * the short way is provably the real path.
 */
export function composeScene(state: GameState, interp: InterpState, alpha: number): SceneModel {
  const smooth = state.mode === "analog";
  const t = smooth ? Math.max(0, Math.min(1, alpha)) : 1;
  const { prev, cur } = interp;
  const { width, height, edgeWrap } = state;

  const snake: Vec2[] = cur.map((segment, index) => {
    const from = prev[Math.min(index, prev.length - 1)] ?? segment;
    const x = wrapAxis(from.x + axisDelta(from.x, segment.x, width, edgeWrap) * t, width);
    const y = wrapAxis(from.y + axisDelta(from.y, segment.y, height, edgeWrap) * t, height);
    return { x, y };
  });

  return {
    camera: state.threeD ? "3d" : "flat",
    wallsLethal: !state.edgeWrap,
    snake,
    food: state.food,
    token: state.powerup === null ? null : { kind: state.powerup.kind, pos: state.powerup.pos },
  };
}
