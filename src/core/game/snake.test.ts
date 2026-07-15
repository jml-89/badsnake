import { describe, expect, it } from "vitest";
import { initialState, tick, cellIntervalMs, SIM_DT_MS } from "./snake";
import { EAST, NORTH, QUARTER, SOUTH, WEST, signedDelta } from "./heading";
import type { GameState, Intent, Vec2 } from "./types";

const NONE: Intent[] = [];

/** Milliseconds to commit exactly one cardinal cell at the current score. */
const oneCell = (s: GameState): number => cellIntervalMs(s.score);

describe("snake kernel", () => {
  // --- Cardinal movement: quantized, exact grid snap ------------------------

  it("advances the head one cell per cell-interval along the heading", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 42 });
    const head0 = s0.snake[0]!;
    const s1 = tick(s0, NONE, oneCell(s0)); // one cell of travel in one step
    expect(s1.snake[0]).toEqual({ x: head0.x + 1, y: head0.y }); // heading starts east
    expect(s1.snake.length).toBe(s0.snake.length);
    expect(s1.tick).toBe(1);
  });

  it("keeps the cardinal head snapped to integer cells across ticks", () => {
    let s = initialState({ width: 20, height: 20, seed: 1 });
    for (let i = 0; i < 30 && s.phase === "playing"; i++) {
      s = tick(s, i === 12 ? [{ kind: "turn", turn: "right" }] : NONE, SIM_DT_MS);
      const head = s.snake[0]!;
      expect(Number.isInteger(head.x) && Number.isInteger(head.y)).toBe(true);
    }
  });

  it("rejects a 180° reversal from a single input", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // heading east
    const s1 = tick(s0, [{ kind: "steer", direction: "west" }], oneCell(s0));
    expect(s1.heading).toBe(EAST);
    expect(s1.phase).toBe("playing");
  });

  it("applies at most one heading change per cell", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // east
    const s1 = tick(
      s0,
      [
        { kind: "turn", turn: "left" }, // east -> north (wins, latches)
        { kind: "steer", direction: "east" }, // ignored this cell
      ],
      oneCell(s0),
    );
    expect(s1.heading).toBe(NORTH);
  });

  it("dies on wall collision", () => {
    let s = initialState({ width: 5, height: 5, seed: 1 });
    for (let i = 0; i < 6 && s.phase === "playing"; i++) {
      s = tick(s, NONE, oneCell(s));
    }
    expect(s.phase).toBe("dead");
  });

  it("grows and scores when eating food", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    // Stage food directly ahead of the head (heading east).
    const staged: GameState = { ...base, food: { x: head.x + 1, y: head.y } };
    const after = tick(staged, NONE, oneCell(staged));
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
      for (const intents of script) s = tick(s, intents, SIM_DT_MS);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("pauses and resumes without advancing the simulation or its clock", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 });
    const paused = tick(s0, [{ kind: "pause" }], SIM_DT_MS);
    expect(paused.phase).toBe("paused");
    const stillPaused = tick(paused, NONE, SIM_DT_MS);
    expect(stillPaused.snake).toEqual(paused.snake);
    expect(stillPaused.tick).toBe(s0.tick);
    expect(stillPaused.clockMs).toBe(s0.clockMs); // the clock freezes too
    const resumed = tick(paused, [{ kind: "pause" }], SIM_DT_MS);
    expect(resumed.phase).toBe("playing");
  });

  it("starts in cardinal mode on a cardinal heading, with no power-up yet", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 });
    expect(s0.mode).toBe("cardinal");
    expect(s0.heading).toBe(EAST);
    // Power-ups now appear on a timer (ms), so the board starts clean with the
    // first spawn scheduled for a future time.
    expect(s0.powerup).toBeNull();
    expect(s0.powerupNextAt).toBeGreaterThan(0);
  });

  it("snaps a steerAngle to the nearest cardinal in cardinal mode", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // heading east
    // An angle a hair south of due-east snaps to SOUTH (a legal 90° turn).
    const s1 = tick(s0, [{ kind: "steerAngle", index: SOUTH - 4 }], oneCell(s0));
    expect(s1.heading).toBe(SOUTH);
    // An angle near due-west would be a reversal from east → rejected.
    const s2 = tick(s0, [{ kind: "steerAngle", index: WEST + 2 }], oneCell(s0));
    expect(s2.heading).toBe(EAST);
  });

  // --- Analog movement: continuous, smooth ---------------------------------

  it("collecting the joystick switches to analog and clears the token", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    // Stage the joystick directly ahead of the head (heading east).
    const ahead: Vec2 = { x: head.x + 1, y: head.y };
    const staged: GameState = { ...base, powerup: ahead };
    const after = tick(staged, NONE, oneCell(staged));
    expect(after.mode).toBe("analog");
    expect(after.powerup).toBeNull();
    // Picking it up neither grows the snake nor scores.
    expect(after.snake.length).toBe(base.snake.length);
    expect(after.score).toBe(base.score);
  });

  it("analog steering is bounded per tick — no instant spin-around", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null };
    // Spamming turns in a single tick cannot rotate more than a quarter turn,
    // so the snake can never reverse from one tick of input.
    const spam: Intent[] = Array.from({ length: 100 }, () => ({ kind: "turn", turn: "right" }));
    const after = tick(analog, spam, SIM_DT_MS);
    const rotated = Math.abs(signedDelta(base.heading, after.heading));
    expect(rotated).toBeGreaterThan(0); // it did turn
    expect(rotated).toBeLessThan(QUARTER); // but well short of even 90°
  });

  it("analog holds a heading between the cardinals and moves off the integer grid", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null };
    const after = tick(analog, [{ kind: "turn", turn: "right" }], SIM_DT_MS);
    const isCardinal = [EAST, SOUTH, WEST, NORTH].includes(after.heading);
    expect(isCardinal).toBe(false); // a genuinely off-axis heading
    // ...and the head advanced off the integer grid it started on.
    const head = after.snake[0]!;
    expect(Number.isInteger(head.x) && Number.isInteger(head.y)).toBe(false);
  });

  it("analog advances the head a sub-cell fraction each tick (continuous motion)", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null, heading: EAST };
    const head0 = analog.snake[0]!;
    const after = tick(analog, NONE, SIM_DT_MS);
    const moved = after.snake[0]!.x - head0.x;
    // One fixed tick is a fraction of a cell — not the whole cell a grid step is.
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(1);
  });

  it("analog is free to U-turn over several ticks (unlike cardinal)", () => {
    let s: GameState = initialState({ width: 60, height: 60, seed: 3 });
    s = { ...s, mode: "analog", powerup: null, heading: EAST };
    const start = s.heading;
    let crossedQuarter = false;
    for (let i = 0; i < 20 && s.phase === "playing"; i++) {
      s = tick(s, [{ kind: "turn", turn: "right" }], SIM_DT_MS);
      if (Math.abs(signedDelta(start, s.heading)) > QUARTER) crossedQuarter = true;
    }
    expect(crossedQuarter).toBe(true);
  });

  it("follows a steerAngle at full resolution in analog mode, bounded per tick", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null, heading: EAST };
    // Point far away (south): the heading rotates toward it but not all the way in
    // one tick, and lands off the cardinal axis.
    const after = tick(analog, [{ kind: "steerAngle", index: SOUTH }], SIM_DT_MS);
    const moved = signedDelta(EAST, after.heading);
    expect(moved).toBeGreaterThan(0); // turned toward south (clockwise)
    expect(after.heading).not.toBe(SOUTH); // but did not snap there
    expect(after.heading).not.toBe(EAST);
  });

  it("stays a deterministic fold in analog mode", () => {
    const run = (): GameState => {
      let s: GameState = initialState({ width: 30, height: 30, seed: 9 });
      s = { ...s, mode: "analog", powerup: null };
      const script: Intent[][] = [
        [{ kind: "turn", turn: "right" }],
        [],
        [{ kind: "turn", turn: "right" }],
        [{ kind: "turn", turn: "left" }],
        [],
        [{ kind: "steer", direction: "north" }],
      ];
      for (const intents of script) s = tick(s, intents, SIM_DT_MS);
      return s;
    };
    expect(run()).toEqual(run());
  });

  // --- Difficulty curve + power-up lifecycle -------------------------------

  it("starts slow and speeds up as the score climbs, then clamps", () => {
    const slow = cellIntervalMs(0);
    const fast = cellIntervalMs(5);
    const capped = cellIntervalMs(1000);
    expect(fast).toBeLessThan(slow); // each food tightens the interval
    expect(capped).toBeGreaterThan(0); // never hits zero...
    expect(capped).toBeLessThan(fast); // ...but does keep dropping to a floor
    expect(cellIntervalMs(5000)).toBe(capped); // the floor holds
  });

  it("spawns a power-up when its scheduled time arrives, then despawns after the TTL", () => {
    const base = initialState({ width: 12, height: 12, seed: 5 });
    // Force the next spawn to be due immediately.
    const due: GameState = { ...base, powerupNextAt: base.clockMs };
    const spawned = tick(due, NONE, SIM_DT_MS);
    expect(spawned.powerup).not.toBeNull();
    expect(spawned.powerupExpiresAt).not.toBeNull();
    // Jump the clock to its expiry: the next tick should despawn and reschedule.
    const atExpiry: GameState = { ...spawned, clockMs: spawned.powerupExpiresAt! };
    const gone = tick(atExpiry, NONE, SIM_DT_MS);
    expect(gone.powerup).toBeNull();
    expect(gone.powerupExpiresAt).toBeNull();
    expect(gone.powerupNextAt).toBeGreaterThan(gone.clockMs); // it disappeared on its own — the urgency
  });

  it("reschedules a fresh power-up after one is collected", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    const staged: GameState = {
      ...base,
      powerup: { x: head.x + 1, y: head.y },
      powerupExpiresAt: base.clockMs + 5000,
    };
    const after = tick(staged, NONE, oneCell(staged));
    expect(after.powerup).toBeNull();
    expect(after.powerupExpiresAt).toBeNull();
    expect(after.powerupNextAt).toBeGreaterThan(after.clockMs); // next one is scheduled ahead
  });
});
