import { describe, expect, it } from "vitest";
import { resolveStick } from "./touch";
import { EAST, NORTH, SOUTH, WEST } from "../../core/game/heading";

// `resolveStick` is the pure core of the floating joystick: touchdown origin +
// current thumb point -> clamped knob offset + heading index. It carries the
// whole "no snap to thumb" contract, so it is unit-tested here in Node with no
// browser — the DOM wiring around it (positioning the base, capturing the
// pointer) is the thin, untested shell. See the file header in touch.ts.

const RADIUS = 64;

describe("resolveStick (floating joystick)", () => {
  it("emits no direction the instant the thumb lands (origin === point)", () => {
    // The bug this fixes: a static stick reads a direction if the thumb touches
    // down off-centre. With a floating origin, touchdown is always dead-centre.
    const { dx, dy, index } = resolveStick({ x: 900, y: 320 }, { x: 900, y: 320 }, RADIUS);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(index).toBeNull();
  });

  it("stays silent for small thumb travel inside the deadzone", () => {
    // A few pixels north of where the thumb landed — the exact scenario from the
    // report — must not yet steer.
    const { index } = resolveStick({ x: 100, y: 100 }, { x: 100, y: 92 }, RADIUS);
    expect(index).toBeNull();
  });

  it("steers relative to the touchdown point, not the screen", () => {
    // Same 40px-north gesture from two very different landing points yields the
    // same heading: direction is a function of the gesture, not absolute position.
    const a = resolveStick({ x: 100, y: 400 }, { x: 100, y: 360 }, RADIUS);
    const b = resolveStick({ x: 700, y: 120 }, { x: 700, y: 80 }, RADIUS);
    expect(a.index).toBe(NORTH);
    expect(b.index).toBe(NORTH);
  });

  it("maps each cardinal gesture to its heading (y points down)", () => {
    const o = { x: 200, y: 200 };
    const push = 40; // clears the deadzone (0.28 * 64 ≈ 18px)
    expect(resolveStick(o, { x: o.x + push, y: o.y }, RADIUS).index).toBe(EAST);
    expect(resolveStick(o, { x: o.x, y: o.y + push }, RADIUS).index).toBe(SOUTH);
    expect(resolveStick(o, { x: o.x - push, y: o.y }, RADIUS).index).toBe(WEST);
    expect(resolveStick(o, { x: o.x, y: o.y - push }, RADIUS).index).toBe(NORTH);
  });

  it("clamps the knob offset to the rim at full tilt", () => {
    // Thumb far past the rim: the knob rides the radius, direction preserved.
    const { dx, dy } = resolveStick({ x: 0, y: 0 }, { x: 300, y: 0 }, RADIUS);
    expect(dx).toBeCloseTo(RADIUS, 6);
    expect(dy).toBeCloseTo(0, 6);
    expect(Math.hypot(dx, dy)).toBeCloseTo(RADIUS, 6);
  });
});
