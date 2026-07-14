import { describe, expect, it } from "vitest";
import { initialState, tick } from "./snake";
import type { GameState, Intent } from "./types";

const NONE: Intent[] = [];

describe("snake kernel", () => {
  it("advances the head one cell per tick along the heading", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 42 });
    const head0 = s0.snake[0]!;
    const s1 = tick(s0, NONE, 120);
    expect(s1.snake[0]).toEqual({ x: head0.x + 1, y: head0.y }); // heading starts east
    expect(s1.snake.length).toBe(s0.snake.length);
    expect(s1.tick).toBe(1);
  });

  it("rejects a 180° reversal from a single input", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // heading east
    const s1 = tick(s0, [{ kind: "steer", direction: "west" }], 120);
    expect(s1.heading).toBe("east");
    expect(s1.phase).toBe("playing");
  });

  it("applies at most one heading change per tick", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // east
    const s1 = tick(
      s0,
      [
        { kind: "turn", turn: "left" }, // east -> north (wins)
        { kind: "steer", direction: "east" }, // ignored this tick
      ],
      120,
    );
    expect(s1.heading).toBe("north");
  });

  it("dies on wall collision", () => {
    let s = initialState({ width: 5, height: 5, seed: 1 });
    for (let i = 0; i < 6 && s.phase === "playing"; i++) {
      s = tick(s, NONE, 120);
    }
    expect(s.phase).toBe("dead");
  });

  it("grows and scores when eating food", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    // Stage food directly ahead of the head (heading east).
    const staged: GameState = { ...base, food: { x: head.x + 1, y: head.y } };
    const after = tick(staged, NONE, 120);
    expect(after.score).toBe(base.score + 1);
    expect(after.snake.length).toBe(base.snake.length + 1);
    expect(after.snake[0]).toEqual({ x: head.x + 1, y: head.y });
  });

  it("is a deterministic fold: same seed + same intents => identical state", () => {
    const run = (): GameState => {
      let s = initialState({ width: 12, height: 12, seed: 7 });
      const script: Intent[][] = [
        [{ kind: "turn", turn: "left" }],
        [],
        [],
        [{ kind: "turn", turn: "right" }],
        [],
        [],
      ];
      for (const intents of script) {
        s = tick(s, intents, 120);
      }
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("pauses and resumes without advancing the simulation", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 });
    const paused = tick(s0, [{ kind: "pause" }], 120);
    expect(paused.phase).toBe("paused");
    const stillPaused = tick(paused, NONE, 120);
    expect(stillPaused.snake).toEqual(paused.snake);
    expect(stillPaused.tick).toBe(s0.tick);
    const resumed = tick(paused, [{ kind: "pause" }], 120);
    expect(resumed.phase).toBe("playing");
  });
});
