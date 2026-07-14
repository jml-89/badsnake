import type { GameState } from "../game/types";

/**
 * Rendering is a SINK: state (plus render-time alpha) goes in, pixels come out,
 * and nothing flows back into the kernel. Because nothing flows back it cannot
 * corrupt kernel purity, so the app calls it directly — this interface exists
 * only to keep the renderer swappable, not to guard correctness.
 */
export interface Renderer {
  /** @param alpha interpolation factor in [0, 1] between the last and next tick. */
  render(state: GameState, alpha: number): void;
  dispose(): void;
}
