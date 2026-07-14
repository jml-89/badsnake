import type { Intent } from "../../core/game/types";
import type { IntentSource } from "../../core/ports/input";

// The bindings layer: raw device codes -> device-agnostic intents. This table
// is plain data, which is exactly what makes remapping and multi-device support
// fall out later, and what keeps recordings rebind-proof (we record intents,
// not keys). Arrow keys and WASD steer absolutely; Q/E turn relatively.
const BINDINGS: Readonly<Record<string, Intent>> = {
  ArrowUp: { kind: "steer", direction: "north" },
  ArrowDown: { kind: "steer", direction: "south" },
  ArrowLeft: { kind: "steer", direction: "west" },
  ArrowRight: { kind: "steer", direction: "east" },
  KeyW: { kind: "steer", direction: "north" },
  KeyS: { kind: "steer", direction: "south" },
  KeyA: { kind: "steer", direction: "west" },
  KeyD: { kind: "steer", direction: "east" },
  KeyQ: { kind: "turn", turn: "left" },
  KeyE: { kind: "turn", turn: "right" },
  Space: { kind: "pause" },
  KeyR: { kind: "restart" },
};

export function createKeyboardInput(target: Window = window): IntentSource {
  let buffer: Intent[] = [];

  target.addEventListener("keydown", (event: KeyboardEvent) => {
    const intent = BINDINGS[event.code];
    if (intent !== undefined) {
      buffer.push(intent);
      event.preventDefault();
    }
  });

  return {
    drain() {
      const drained = buffer;
      buffer = [];
      return drained;
    },
  };
}
