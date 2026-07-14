// A pure, deterministic PRNG (mulberry32). No Math.random, no clock — the state
// is a plain uint32 that lives inside GameState, so a given seed always
// produces the same sequence. This is the RNG "port" realised as pure code:
// the only injected dependency is the seed.

export type Rng = number;

export function seedRng(seed: number): Rng {
  return seed >>> 0;
}

/** Returns a value in [0, 1) and the advanced RNG state. */
export function nextRng(state: Rng): { readonly value: number; readonly state: Rng } {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: t >>> 0 };
}
