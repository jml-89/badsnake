/** A source of monotonic wall-clock time, in milliseconds. Owned by the app. */
export interface Clock {
  now(): number;
}
