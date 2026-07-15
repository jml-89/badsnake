import { describe, expect, it } from "vitest";
import { advanceInterp, composeScene, initialInterp, WRAP_SNAP } from "./scene-model";
import { initialState } from "../../core/game/snake";
import type { GameState } from "../../core/game/types";

// The scene model is pure and three.js-free, so the *decisions* a frame is built
// from — which camera, where each node sits, the wrap-seam snap, the token — are
// unit-testable in Node with no browser. This is the coverage the headless
// screenshot used to stand in for; pixels (culling, sprite support, framing,
// aesthetics) remain a human/GL concern, but scene composition is checked here.

const base = initialState({ width: 20, height: 20, seed: 1 });
const st = (over: Partial<GameState>): GameState => ({ ...base, ...over });

/** Drive the (prev,cur) pair the way the sink does: seed with A, advance to B. */
function pairAcross(a: GameState, b: GameState) {
  return advanceInterp(advanceInterp(initialInterp, a), b);
}

describe("scene model", () => {
  // --- Camera / walls: the flag → view mapping ------------------------------

  it("selects the tilted camera only when the 3D flag is set", () => {
    expect(composeScene(st({ threeD: false }), initialInterp, 1).camera).toBe("flat");
    expect(composeScene(st({ threeD: true }), initialInterp, 1).camera).toBe("3d");
  });

  it("reads walls as lethal until the portal power-up turns edge-wrap on", () => {
    expect(composeScene(st({ edgeWrap: false }), initialInterp, 1).wallsLethal).toBe(true);
    expect(composeScene(st({ edgeWrap: true }), initialInterp, 1).wallsLethal).toBe(false);
  });

  // --- Token: kind + position pass through, null when absent ----------------

  it("passes the power-up token through by kind and position, or null", () => {
    const none = composeScene(st({ powerup: null }), initialInterp, 1);
    expect(none.token).toBeNull();

    const withTok = composeScene(
      st({ powerup: { kind: "portal", pos: { x: 3, y: 7 } } }),
      initialInterp,
      1,
    );
    expect(withTok.token).toEqual({ kind: "portal", pos: { x: 3, y: 7 } });
  });

  it("carries the food cell and puts the head at snake[0]", () => {
    const s = st({ snake: [{ x: 5, y: 6 }, { x: 4, y: 6 }], food: { x: 9, y: 2 } });
    const m = composeScene(s, pairAcross(s, s), 1);
    expect(m.food).toEqual({ x: 9, y: 2 });
    expect(m.snake[0]).toEqual({ x: 5, y: 6 });
    expect(m.snake).toHaveLength(2);
  });

  // --- Cardinal snaps; analog glides ---------------------------------------

  it("draws cardinal raw — no interpolation even mid-alpha", () => {
    const a = st({ mode: "cardinal", snake: [{ x: 5, y: 5 }], tick: 10 });
    const b = st({ mode: "cardinal", snake: [{ x: 6, y: 5 }], tick: 11 });
    const m = composeScene(b, pairAcross(a, b), 0.5);
    expect(m.snake[0]).toEqual({ x: 6, y: 5 }); // committed cell, not a half-step
  });

  it("glides an analog node alpha of the way from the previous tick", () => {
    const a = st({ mode: "analog", snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }], tick: 10 });
    const b = st({ mode: "analog", snake: [{ x: 6, y: 5 }, { x: 5, y: 5 }], tick: 11 });
    const m = composeScene(b, pairAcross(a, b), 0.5);
    expect(m.snake[0]!.x).toBeCloseTo(5.5); // halfway between prev head (5) and cur head (6)
  });

  // --- The wrap seam: snap across it, don't smear ---------------------------

  it("snaps (does not lerp) a node that jumped a portal seam", () => {
    // Head wrapped from the right edge to the left: a whole-board x jump.
    const a = st({ mode: "analog", edgeWrap: true, snake: [{ x: 19.6, y: 5 }], tick: 10 });
    const b = st({ mode: "analog", edgeWrap: true, snake: [{ x: 0.2, y: 5 }], tick: 11 });
    expect(Math.abs(19.6 - 0.2)).toBeGreaterThan(WRAP_SNAP); // precondition: it is a seam
    const m = composeScene(b, pairAcross(a, b), 0.5);
    expect(m.snake[0]!.x).toBeCloseTo(0.2); // drawn at the destination, not the ~9.9 midpoint
  });

  // --- The pair resets: snap, don't glide, across a discontinuity -----------

  it("snaps on death instead of gliding from the last live position", () => {
    const a = st({ mode: "analog", snake: [{ x: 5, y: 5 }], tick: 10 });
    const dead = st({ mode: "analog", snake: [{ x: 6, y: 5 }], tick: 11, phase: "dead" });
    const m = composeScene(dead, pairAcross(a, dead), 0.5);
    expect(m.snake[0]).toEqual({ x: 6, y: 5 }); // frozen at the death frame, no half-glide back
  });

  it("snaps when the mode flips (analog → cardinal via the digital power-up)", () => {
    const a = st({ mode: "analog", snake: [{ x: 5, y: 5 }], tick: 10 });
    const b = st({ mode: "cardinal", snake: [{ x: 6, y: 5 }], tick: 11 });
    const m = composeScene(b, pairAcross(a, b), 0.5);
    expect(m.snake[0]).toEqual({ x: 6, y: 5 });
  });

  it("snaps across a multi-tick catch-up jump (hidden-tab recovery)", () => {
    const a = st({ mode: "analog", snake: [{ x: 5, y: 5 }], tick: 10 });
    const b = st({ mode: "analog", snake: [{ x: 9, y: 5 }], tick: 15 }); // +5 ticks at once
    const m = composeScene(b, pairAcross(a, b), 0.5);
    expect(m.snake[0]).toEqual({ x: 9, y: 5 });
  });

  it("snaps on the very first frame (no previous tick to glide from)", () => {
    const a = st({ mode: "analog", snake: [{ x: 5, y: 5 }], tick: 0 });
    const m = composeScene(a, advanceInterp(initialInterp, a), 0.5);
    expect(m.snake[0]).toEqual({ x: 5, y: 5 });
  });
});
