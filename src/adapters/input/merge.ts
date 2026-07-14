import type { IntentSource } from "../../core/ports/input";

/**
 * Fan several input devices into one intent stream. Because every device speaks
 * the same device-agnostic intent vocabulary, merging is just concatenating each
 * source's drained buffer — no per-device special-casing. Order is stable
 * (sources are drained in the order given), which matters for the kernel's
 * "first legal heading change per tick" rule.
 */
export function mergeInputs(sources: readonly IntentSource[]): IntentSource {
  return {
    drain() {
      return sources.flatMap((source) => source.drain());
    },
  };
}
