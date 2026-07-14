import type { Direction, Intent } from "../../core/game/types";
import type { IntentSource } from "../../core/ports/input";

// Touch/pointer input, virtualized to intent exactly like the keyboard adapter.
// Two impure DOM surfaces live here because both *emit intents*:
//
//   1. An on-screen D-pad — a large, mostly-transparent cross anchored bottom-
//      right, where a right thumb naturally rests. It reads on `pointerdown`
//      (not click), so a press turns into a `steer` intent with the lowest
//      latency the platform allows and no gesture recognition in the path.
//   2. Pause / Restart buttons — a phone has no Space or R key, so the two
//      control intents need tappable homes.
//
// The score readout and the PAUSED / GAME OVER banner are NOT here: those read
// game state and are a display sink (see adapters/hud). This adapter only ever
// pushes intents; it never looks at state. That keeps the input port and the
// render sink cleanly separated, as the architecture intends.

const STYLE_ID = "bs-touch-style";
const ROOT_ID = "bs-touch-root";

const CSS = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none; /* only the buttons themselves are interactive */
  color: #e2f5ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#${ROOT_ID} button {
  pointer-events: auto;
  touch-action: none; /* no scroll / double-tap-zoom stealing the press */
  cursor: pointer;
  margin: 0;
  color: inherit;
  background: rgba(56, 189, 248, 0.18);
  border: 2px solid rgba(125, 211, 252, 0.45);
  -webkit-tap-highlight-color: transparent;
}
#${ROOT_ID} button:active {
  background: rgba(125, 211, 252, 0.5);
}

/* --- D-pad: bottom-right, large, transparent --- */
#${ROOT_ID} .bs-dpad {
  position: absolute;
  right: max(env(safe-area-inset-right), 4vw);
  bottom: max(env(safe-area-inset-bottom), 5vh);
  width: min(46vw, 240px);
  aspect-ratio: 1;
  display: grid;
  grid-template: repeat(3, 1fr) / repeat(3, 1fr);
  gap: 6%;
  opacity: 0.35;
}
#${ROOT_ID} .bs-dpad button {
  border-radius: 16%;
  font-size: min(9vw, 44px);
  line-height: 1;
  padding: 0;
}
#${ROOT_ID} .bs-dpad .up { grid-area: 1 / 2; }
#${ROOT_ID} .bs-dpad .left { grid-area: 2 / 1; }
#${ROOT_ID} .bs-dpad .right { grid-area: 2 / 3; }
#${ROOT_ID} .bs-dpad .down { grid-area: 3 / 2; }

/* --- Pause / Restart: top-right, out of the thumb's way --- */
#${ROOT_ID} .bs-controls {
  position: absolute;
  top: max(env(safe-area-inset-top), 2vh);
  right: max(env(safe-area-inset-right), 3vw);
  display: flex;
  gap: 8px;
}
#${ROOT_ID} .bs-controls button {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  font-size: 20px;
  line-height: 1;
  opacity: 0.6;
}
`;

const STEER: Record<"up" | "down" | "left" | "right", Direction> = {
  up: "north",
  down: "south",
  left: "west",
  right: "east",
};

export function createTouchInput(doc: Document = document): IntentSource {
  let buffer: Intent[] = [];

  // Idempotent injection so a dev-server hot reload doesn't stack overlays.
  doc.getElementById(ROOT_ID)?.remove();
  if (doc.getElementById(STYLE_ID) === null) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const root = doc.createElement("div");
  root.id = ROOT_ID;

  const push = (intent: Intent): void => {
    buffer.push(intent);
  };

  const button = (label: string, className: string, intent: Intent): HTMLButtonElement => {
    const el = doc.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    // pointerdown, not click: the intent fires the instant the thumb lands.
    el.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      push(intent);
    });
    return el;
  };

  const dpad = doc.createElement("div");
  dpad.className = "bs-dpad";
  dpad.setAttribute("aria-label", "steer");
  dpad.append(
    button("▲", "up", { kind: "steer", direction: STEER.up }),
    button("◀", "left", { kind: "steer", direction: STEER.left }),
    button("▶", "right", { kind: "steer", direction: STEER.right }),
    button("▼", "down", { kind: "steer", direction: STEER.down }),
  );

  const controls = doc.createElement("div");
  controls.className = "bs-controls";
  controls.append(
    button("⏸", "pause", { kind: "pause" }),
    button("↻", "restart", { kind: "restart" }),
  );

  root.append(controls, dpad);
  doc.body.appendChild(root);

  return {
    drain() {
      const drained = buffer;
      buffer = [];
      return drained;
    },
  };
}
