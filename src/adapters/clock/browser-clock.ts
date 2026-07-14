import type { Clock } from "../../core/ports/clock";

/** Real monotonic time. Impure — lives outside the kernel by design. */
export function createBrowserClock(): Clock {
  return { now: () => performance.now() };
}
