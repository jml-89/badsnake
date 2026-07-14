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

  // --- Joystick (bottom-left) ---
  const RADIUS = 64;
  const base = doc.createElement("div");
  Object.assign(base.style, {
    position: "absolute",
    left: "24px",
    bottom: "24px",
    width: `${RADIUS * 2}px`,
    height: `${RADIUS * 2}px`,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    touchAction: "none",
    pointerEvents: "auto",
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

  const updateFromEvent = (ev: PointerEvent): void => {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = ev.clientX - cx;
    let dy = ev.clientY - cy;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > RADIUS) {
      dx = (dx / mag) * RADIUS;
      dy = (dy / mag) * RADIUS; // clamp the knob to the rim
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stickIndex = offsetToIndex(dx, dy, RADIUS);
  };

  const releaseStick = (): void => {
    pointerId = null;
    stickIndex = null;
    knob.style.transform = "translate(0px, 0px)";
  };

  base.addEventListener("pointerdown", (ev) => {
    pointerId = ev.pointerId;
    base.setPointerCapture(ev.pointerId);
    updateFromEvent(ev);
    ev.preventDefault();
  });
  base.addEventListener("pointermove", (ev) => {
    if (ev.pointerId === pointerId) updateFromEvent(ev);
  });
  base.addEventListener("pointerup", releaseStick);
  base.addEventListener("pointercancel", releaseStick);

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
