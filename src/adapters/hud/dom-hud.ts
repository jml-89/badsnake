import type { GameState, Phase } from "../../core/game/types";

// The HUD is a display SINK, exactly like the renderer: game state flows in,
// pixels (here, DOM text) come out, and nothing flows back into the kernel.
// Because nothing flows back it can't corrupt purity or replay, so — following
// the same reasoning the architecture applies to the renderer — it is called
// directly and needs no port interface. It only reads state; the interactive
// controls that *emit* intents live in adapters/input/touch.ts instead.

const STYLE_ID = "bs-hud-style";
const ROOT_ID = "bs-hud-root";

const CSS = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 9;
  pointer-events: none; /* never intercept a tap meant for the board or D-pad */
  color: #e2f5ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#${ROOT_ID} .bs-score {
  position: absolute;
  top: max(env(safe-area-inset-top), 2vh);
  left: max(env(safe-area-inset-left), 3vw);
  font-size: clamp(16px, 4vw, 28px);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
#${ROOT_ID} .bs-banner {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  text-align: center;
  white-space: pre-line;
  font-size: clamp(24px, 7vw, 48px);
  font-weight: 700;
  line-height: 1.4;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
}
#${ROOT_ID} .bs-banner[data-show="true"] {
  display: grid;
}
`;

const BANNER: Record<Phase, string> = {
  playing: "",
  paused: "PAUSED",
  dead: "GAME OVER\ntap ↻ to restart",
};

export interface Hud {
  /** Called every frame after render; cheap — only touches the DOM on change. */
  update(state: GameState): void;
  dispose(): void;
}

export function createHud(doc: Document = document): Hud {
  doc.getElementById(ROOT_ID)?.remove();
  if (doc.getElementById(STYLE_ID) === null) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const root = doc.createElement("div");
  root.id = ROOT_ID;

  const score = doc.createElement("div");
  score.className = "bs-score";

  const banner = doc.createElement("div");
  banner.className = "bs-banner";

  root.append(score, banner);
  doc.body.appendChild(root);

  // Track last-rendered values so the per-frame update only writes to the DOM
  // when something actually changed.
  let lastScore = Number.NaN;
  let lastPhase: Phase | null = null;

  return {
    update(state: GameState): void {
      if (state.score !== lastScore) {
        score.textContent = `Score ${state.score}`;
        lastScore = state.score;
      }
      if (state.phase !== lastPhase) {
        banner.textContent = BANNER[state.phase];
        banner.dataset.show = state.phase === "playing" ? "false" : "true";
        lastPhase = state.phase;
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
