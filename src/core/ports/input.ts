import type { Intent } from "../game/types";

/**
 * The intent layer of the input model. Adapters capture raw device events and
 * map them (via bindings) into device-agnostic intents; the kernel only ever
 * sees the drained buffer, never a keycode.
 */
export interface IntentSource {
  /** Returns and clears the intents buffered since the last drain. */
  drain(): Intent[];
}
