import { describe, expect, it } from "vitest";
import { initialState, tick, tickIntervalMs } from "./snake";
import { EAST, NORTH, QUARTER, SOUTH, WEST, signedDelta } from "./heading";
import type { GameState, Intent, Vec2 } from "./types";

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
    expect(s1.heading).toBe(EAST);
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
    expect(s1.heading).toBe(NORTH);
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

  it("starts in cardinal mode on a cardinal heading, with no power-up yet", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 });
    expect(s0.mode).toBe("cardinal");
    expect(s0.heading).toBe(EAST);
    // Power-ups now appear on a timer, so the board starts clean with the first
    // spawn scheduled for a future tick.
    expect(s0.powerup).toBeNull();
    expect(s0.powerupNextAt).toBeGreaterThan(0);
  });

  it("collecting the joystick switches to analog and clears the token", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    // Stage the joystick directly ahead of the head (heading east).
    const ahead: Vec2 = { x: head.x + 1, y: head.y };
    const staged: GameState = { ...base, powerup: ahead };
    const after = tick(staged, NONE, 120);
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
    const after = tick(analog, spam, 120);
    const rotated = Math.abs(signedDelta(base.heading, after.heading));
    expect(rotated).toBeGreaterThan(0); // it did turn
    expect(rotated).toBeLessThan(QUARTER); // but well short of even 90°
  });

  it("analog can hold a heading between the cardinals", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null };
    const after = tick(analog, [{ kind: "turn", turn: "right" }], 120);
    const isCardinal = [EAST, SOUTH, WEST, NORTH].includes(after.heading);
    expect(isCardinal).toBe(false); // a genuinely off-axis heading
    // ...and the head advanced off the integer grid it started on.
    const head = after.snake[0]!;
    expect(Number.isInteger(head.x) && Number.isInteger(head.y)).toBe(false);
  });

  it("analog is free to U-turn over several ticks (unlike cardinal)", () => {
    let s: GameState = initialState({ width: 60, height: 60, seed: 3 });
    s = { ...s, mode: "analog", powerup: null, heading: EAST };
    const start = s.heading;
    // Hold right; over enough ticks the heading sweeps past 90° — impossible in
    // cardinal mode, where reversals and >90° turns are rejected.
    let crossedQuarter = false;
    for (let i = 0; i < 12 && s.phase === "playing"; i++) {
      s = tick(s, [{ kind: "turn", turn: "right" }], 120);
      if (Math.abs(signedDelta(start, s.heading)) > QUARTER) crossedQuarter = true;
    }
    expect(crossedQuarter).toBe(true);
  });

  it("snaps a steerAngle to the nearest cardinal in cardinal mode", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 }); // heading east
    // An angle a hair south of due-east snaps to SOUTH (a legal 90° turn).
    const s1 = tick(s0, [{ kind: "steerAngle", index: SOUTH - 4 }], 120);
    expect(s1.heading).toBe(SOUTH);
    // An angle near due-west would be a reversal from east → rejected.
    const s2 = tick(s0, [{ kind: "steerAngle", index: WEST + 2 }], 120);
    expect(s2.heading).toBe(EAST);
  });

  it("follows a steerAngle at full resolution in analog mode, bounded per tick", () => {
    const base = initialState({ width: 40, height: 40, seed: 1 });
    const analog: GameState = { ...base, mode: "analog", powerup: null, heading: EAST };
    // Point far away (south): the heading rotates toward it but not all the way in
    // one tick, and lands off the cardinal axis.
    const after = tick(analog, [{ kind: "steerAngle", index: SOUTH }], 120);
    const moved = signedDelta(EAST, after.heading);
    expect(moved).toBeGreaterThan(0); // turned toward south (clockwise)
    expect(after.heading).not.toBe(SOUTH); // but did not snap there
    expect(after.heading).not.toBe(EAST);
  });

  it("starts slow and speeds up as the score climbs, then clamps", () => {
    const s0 = initialState({ width: 10, height: 10, seed: 1 });
    const slow = tickIntervalMs(s0);
    const fast = tickIntervalMs({ ...s0, score: 5 });
    const capped = tickIntervalMs({ ...s0, score: 1000 });
    expect(fast).toBeLessThan(slow); // each food tightens the interval
    expect(capped).toBeGreaterThan(0); // never hits zero...
    expect(capped).toBeLessThan(fast); // ...but does keep dropping to a floor
    // The floor holds: an even higher score can't go below it.
    expect(tickIntervalMs({ ...s0, score: 5000 })).toBe(capped);
  });

  it("spawns a power-up when its scheduled tick arrives, then despawns it", () => {
    const board = { width: 12, height: 12, seed: 5 } as const;
    // Steer the snake in a tight loop so it survives long enough to observe a
    // full appear → vanish cycle without hitting a wall.
    let s = initialState(board);
    const spawnTick = s.powerupNextAt;
    let sawPowerup = false;
    let sawItVanish = false;
    let seenSpawnTick = -1;
    // Circle the snake by turning right every few ticks; plenty of room on 12x12.
    for (let i = 0; i < spawnTick + 120 && s.phase === "playing"; i++) {
      s = tick(s, i % 4 === 0 ? [{ kind: "turn", turn: "right" }] : NONE, 120);
      if (s.powerup !== null && !sawPowerup) {
        sawPowerup = true;
        seenSpawnTick = s.tick;
        expect(s.powerupExpiresAt).not.toBeNull();
      }
      if (sawPowerup && s.powerup === null && !sawItVanish) sawItVanish = true;
    }
    expect(sawPowerup).toBe(true);
    expect(seenSpawnTick).toBeGreaterThanOrEqual(spawnTick);
    expect(sawItVanish).toBe(true); // it disappeared on its own — the urgency
  });

  it("reschedules a fresh power-up after one is collected", () => {
    const base = initialState({ width: 10, height: 10, seed: 1 });
    const head = base.snake[0]!;
    const staged: GameState = {
      ...base,
      powerup: { x: head.x + 1, y: head.y },
      powerupExpiresAt: base.tick + 40,
    };
    const after = tick(staged, NONE, 120);
    expect(after.powerup).toBeNull();
    expect(after.powerupExpiresAt).toBeNull();
    expect(after.powerupNextAt).toBeGreaterThan(after.tick); // next one is scheduled ahead
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
      for (const intents of script) s = tick(s, intents, 120);
      return s;
    };
    expect(run()).toEqual(run());
  });
});
