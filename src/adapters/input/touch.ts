import type { Intent } from "../../core/game/types";
import type { IntentSource } from "../../core/ports/input";
import { HEADINGS } from "../../core/game/heading";

// On-screen touch controls: a thumb-joystick plus pause / restart buttons. Like
// the keyboard, this is a *device* adapter — it captures raw pointer signals and
// emits device-agnostic intents into the same stream. The kernel never learns a
// touch happened.
//
// The joystick is analog by nature, so it emits `steerAngle` (an absolute heading
// index). The atan2 that turns a thumb offset into an angle runs *here*, on the
// impure side; only the quantized integer index crosses into the kernel, so
// determinism (and replay) is untouched. Before the joystick power-up the kernel
// snaps that index to the nearest cardinal; after it, the snake points wherever
// the thumb does.
//
// The stick *floats*: it has no fixed home. Wherever the thumb first lands
// becomes the origin, and the offset is measured from there — not from a fixed
// on-screen centre. That is the standard fix for the "snap to thumb" bug, where a
// static stick reads a direction the instant a thumb touches down a few pixels
// off its centre. With a floating origin the first frame is dead-centre (zero
// offset, inside the deadzone), so no direction is emitted until the thumb
// actually travels.
//
// Controls only mount on coarse pointers (touch), so desktop stays keyboard-only.

const DEADZONE = 0.28; // fraction of the joystick radius the thumb must clear to steer

/** Quantize a thumb offset (screen pixels, y down) to a heading index, or null in the deadzone. */
function offsetToIndex(dx: number, dy: number, radius: number): number | null {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag < radius * DEADZONE) return null;
  // atan2 with y-down matches the kernel's angle convention (index 0 = +x = east,
  // increasing clockwise on screen). Impure trig is fine here — see file header.
  const angle = Math.atan2(dy, dx); // (-π, π]
  const turns = angle / (2 * Math.PI); // (-0.5, 0.5]
  return ((Math.round(turns * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
}

/**
 * Resolve a thumb position against the touchdown origin into a clamped knob
 * offset and a heading index. `dx`/`dy` are the offset from `origin` to `point`,
 * clamped to the joystick radius (so the knob rides the rim at full tilt);
 * `index` is that offset quantized to a heading, or null inside the deadzone.
 *
 * This is the whole no-snap contract in one pure function: when `point` equals
 * `origin` (the instant the thumb lands), the offset is zero and `index` is null
 * — no direction until the thumb moves. Kept browser-free so it is unit-testable
 * in Node, matching the repo's "test the decision, not the pixels" split.
 */
export function resolveStick(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  radius: number,
): { dx: number; dy: number; index: number | null } {
  let dx = point.x - origin.x;
  let dy = point.y - origin.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > radius) {
    dx = (dx / mag) * radius;
    dy = (dy / mag) * radius; // clamp the knob to the rim
  }
  return { dx, dy, index: offsetToIndex(dx, dy, radius) };
}

function styleButton(el: HTMLElement, label: string): void {
  el.textContent = label;
  Object.assign(el.style, {
    width: "56px",
    height: "56px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.85)",
    font: "600 13px/1 system-ui, sans-serif",
    display: "grid",
    placeItems: "center",
    userSelect: "none",
    touchAction: "none",
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);
}

/**
 * Builds the on-screen controls and returns an IntentSource. On non-touch devices
 * it mounts nothing and drains empty, so the composition root can wire it
 * unconditionally alongside the keyboard.
 */
export function createTouchInput(doc: Document = document): IntentSource {
  let buffer: Intent[] = []; // discrete events (pause / restart / a fresh steer this frame)
  let stickIndex: number | null = null; // held joystick direction, replayed each drain

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) {
    return { drain: () => [] };
  }

  const layer = doc.createElement("div");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "10",
    pointerEvents: "none", // only the controls themselves catch input
    touchAction: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  // --- Joystick (floating, bottom-left region) ---
  // `zone` is the invisible touch target: touch anywhere in it and the stick is
  // born there. `base`/`knob` are the visuals, hidden until a thumb lands and
  // repositioned to the touchdown point each time. It's the bottom-left region,
  // not the whole left half — the conventional carve-up. The right half is left
  // free for the buttons, and a top strip is spared so any future HUD there stays
  // tappable.
  const RADIUS = 64;

  const zone = doc.createElement("div");
  Object.assign(zone.style, {
    position: "absolute",
    left: "0",
    bottom: "0",
    width: "50%",
    height: "67%", // bottom two-thirds; spare the top strip for a HUD
    touchAction: "none",
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);

  const base = doc.createElement("div");
  Object.assign(base.style, {
    position: "absolute",
    width: `${RADIUS * 2}px`,
    height: `${RADIUS * 2}px`,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    visibility: "hidden", // shown at the touchdown point on pointerdown
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const knob = doc.createElement("div");
  Object.assign(knob.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "52px",
    height: "52px",
    marginLeft: "-26px",
    marginTop: "-26px",
    borderRadius: "50%",
    background: "rgba(250,204,21,0.85)", // amber, echoing the joystick power-up token
    transition: "transform 60ms ease-out",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  base.appendChild(knob);

  let pointerId: number | null = null;
  // The touchdown point, in viewport pixels. The layer is fixed at inset:0, so
  // viewport coords and layer-local coords coincide — no offset bookkeeping.
  const origin = { x: 0, y: 0 };

  const updateFromEvent = (ev: PointerEvent): void => {
    const { dx, dy, index } = resolveStick(origin, { x: ev.clientX, y: ev.clientY }, RADIUS);
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stickIndex = index;
  };

  const releaseStick = (): void => {
    pointerId = null;
    stickIndex = null;
    knob.style.transform = "translate(0px, 0px)";
    base.style.visibility = "hidden";
  };

  zone.addEventListener("pointerdown", (ev) => {
    pointerId = ev.pointerId;
    zone.setPointerCapture(ev.pointerId);
    origin.x = ev.clientX;
    origin.y = ev.clientY;
    // Place the stick so its centre sits under the thumb, then read it: offset is
    // zero this frame, so no direction is emitted until the thumb travels.
    base.style.left = `${origin.x - RADIUS}px`;
    base.style.top = `${origin.y - RADIUS}px`;
    base.style.visibility = "visible";
    updateFromEvent(ev);
    ev.preventDefault();
  });
  zone.addEventListener("pointermove", (ev) => {
    if (ev.pointerId === pointerId) updateFromEvent(ev);
  });
  zone.addEventListener("pointerup", releaseStick);
  zone.addEventListener("pointercancel", releaseStick);

  // --- Buttons (bottom-right) ---
  const buttons = doc.createElement("div");
  Object.assign(buttons.style, {
    position: "absolute",
    right: "24px",
    bottom: "24px",
    display: "flex",
    gap: "12px",
  } satisfies Partial<CSSStyleDeclaration>);

  const makeButton = (label: string, intent: Intent): HTMLElement => {
    const el = doc.createElement("button");
    styleButton(el, label);
    el.addEventListener("pointerdown", (ev) => {
      buffer.push(intent);
      ev.preventDefault();
    });
    return el;
  };
  buttons.appendChild(makeButton("⏸", { kind: "pause" }));
  buttons.appendChild(makeButton("↻", { kind: "restart" }));

  layer.appendChild(zone);
  layer.appendChild(base);
  layer.appendChild(buttons);
  doc.body.appendChild(layer);

  return {
    drain() {
      const drained = buffer;
      buffer = [];
      // A held joystick keeps steering: replay the current direction each drain.
      if (stickIndex !== null) drained.push({ kind: "steerAngle", index: stickIndex });
      return drained;
    },
  };
}
