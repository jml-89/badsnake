// A QA/debug overlay: an opt-in floating menu that reaches straight into the
// live game to grant power-ups, grow the snake, and flip the 3D camera. It is a
// composition-root affordance — mounted only behind `?debug=1` (see main.ts) —
// so it never ships as part of the default product.
//
// The "expose the wiring, compose later" stance from the elephant work: the game
// doesn't bake any of this in. It exposes exactly two seams — read the current
// state, write a replacement — and this menu drives the same pure kernel helpers
// the real game uses (`applyPowerupEffect`), so a debug grant and a picked-up
// token are the identical state transition. No duplicated rules, no test surface.

import type { GameState, PowerupKind } from "../../core/game/types";
import { applyPowerupEffect } from "../../core/game/snake";
import type { Camera3DStyle } from "../render/three-renderer";

/**
 * The seams the menu drives. `getState`/`setState` are the live game's state cell
 * (closures over the loop's `state` in main.ts); `setCamera3DStyle` swaps the 3D
 * camera pose on the renderer. Everything the menu does routes through these.
 */
export interface DebugMenuPorts {
  getState(): GameState;
  setState(next: GameState): void;
  setCamera3DStyle(style: Camera3DStyle): void;
}

/** How many pellets' worth of length/speed the grow button adds per tap. */
const GROW_STEP = 5;

const POWERUP_LABELS: Record<PowerupKind, string> = {
  analog: "🕹️ analog",
  digital: "📐 digital",
  portal: "🌀 portal",
  threeD: "🧊 3D",
};

const CAMERA_LABELS: Record<Camera3DStyle, string> = {
  high: "high",
  ortho: "ortho",
  low: "low",
};

function styleButton(el: HTMLButtonElement): void {
  el.style.cssText = [
    "font: 600 15px/1 system-ui, sans-serif",
    "padding: 10px 12px",
    "border-radius: 10px",
    "border: 1px solid #3f3f46",
    "background: #18181b",
    "color: #e4e4e7",
    "cursor: pointer",
    "touch-action: manipulation", // no double-tap-zoom lag on phones
    "text-align: left",
  ].join(";");
}

/**
 * Mounts the debug menu into `host` (typically `document.body`). Returns a
 * teardown that removes it. A single collapsed 🐞 button in the bottom-right
 * expands to a column of chunky, thumb-sized controls — deliberately big for
 * phone QA, and clear of the bottom-left touch joystick.
 */
export function mountDebugMenu(host: HTMLElement, ports: DebugMenuPorts): () => void {
  const root = document.createElement("div");
  root.style.cssText = [
    "position: fixed",
    "right: 12px",
    "bottom: 12px",
    "z-index: 1000",
    "display: flex",
    "flex-direction: column",
    "align-items: flex-end",
    "gap: 8px",
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "display: none",
    "flex-direction: column",
    "gap: 8px",
    "padding: 12px",
    "border-radius: 14px",
    "border: 1px solid #3f3f46",
    "background: rgba(9,9,11,0.92)",
    "backdrop-filter: blur(6px)",
    "max-width: 60vw",
  ].join(";");

  const toggle = document.createElement("button");
  toggle.textContent = "🐞";
  styleButton(toggle);
  toggle.style.fontSize = "20px";
  toggle.style.borderRadius = "999px";
  toggle.setAttribute("aria-label", "debug menu");

  let open = false;
  toggle.addEventListener("click", () => {
    open = !open;
    panel.style.display = open ? "flex" : "none";
  });

  function heading(text: string): void {
    const h = document.createElement("div");
    h.textContent = text;
    h.style.cssText = "font: 700 11px/1 system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #71717a; margin-top: 2px";
    panel.appendChild(h);
  }

  function button(label: string, onClick: () => void): void {
    const b = document.createElement("button");
    b.textContent = label;
    styleButton(b);
    b.addEventListener("click", onClick);
    panel.appendChild(b);
  }

  // --- Power-ups: each routes through the kernel's own effect function, so a
  // debug grant is byte-for-byte the same transition as walking over the token.
  heading("grant power-up");
  (Object.keys(POWERUP_LABELS) as PowerupKind[]).forEach((kind) => {
    button(POWERUP_LABELS[kind], () => ports.setState(applyPowerupEffect(ports.getState(), kind)));
  });

  // --- Growth: bump the target length and score (score drives the speed curve),
  // the same fields eating a pellet moves — so this lands you in a longer, faster
  // game to test without playing up to it.
  heading("grow");
  button(`+${GROW_STEP} length & speed`, () => {
    const s = ports.getState();
    ports.setState({ ...s, lengthCells: s.lengthCells + GROW_STEP, score: s.score + GROW_STEP });
  });

  // --- 3D camera: flip the pose live to A/B the perspective styles on-device.
  heading("3D camera");
  (Object.keys(CAMERA_LABELS) as Camera3DStyle[]).forEach((style) => {
    button(CAMERA_LABELS[style], () => {
      const s = ports.getState();
      if (!s.threeD) ports.setState({ ...s, threeD: true }); // switch to 3D so the change is visible
      ports.setCamera3DStyle(style);
    });
  });

  root.appendChild(panel);
  root.appendChild(toggle);
  host.appendChild(root);

  return () => root.remove();
}
