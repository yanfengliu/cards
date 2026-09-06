// The only source of randomness in the prototype.
//
// `Math.random`, `Date.now` and `performance.now` appear nowhere in this repo,
// including here. Every random decision the engine makes flows through an `Rng`
// value that is part of the fight state, so a fight is a pure function of its
// seed and its action list.
//
// The generator is mulberry32: a 32-bit state, one multiply-shift round, good
// enough for uniform target selection and cheap enough to run millions of times
// inside the placement search.

export type Rng = {
  /** Generator state. Public because the fight hash covers it. */
  s: number;
  /** Number of draws taken. Public so instrument checks can compare streams. */
  n: number;
};

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Derive an independent stream seed from a fight seed and a stream name.
 *
 * Separate streams matter for the measurement: deck order must not shift when a
 * bot's placement changes how many targeting rolls a fight consumes.
 */
export function deriveSeed(seed: number, stream: string): number {
  let h = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < stream.length; i++) {
    h ^= stream.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function makeRng(seed: number, stream: string): Rng {
  return { s: deriveSeed(seed, stream), n: 0 };
}

/**
 * Combine several integers into one stream seed. Used by the lookahead bot to
 * give every rollout its own generator, keyed by fight seed, round, candidate
 * and rollout index - deterministic, and disjoint from the fight's own streams.
 */
export function mixSeeds(...parts: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function rngFromSeedValue(value: number): Rng {
  return { s: value >>> 0, n: 0 };
}

export function cloneRng(r: Rng): Rng {
  return { s: r.s, n: r.n };
}

export function nextU32(r: Rng): number {
  r.n++;
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

export function nextFloat(r: Rng): number {
  return nextU32(r) / 4294967296;
}

/** Uniform integer in [0, bound). */
export function nextInt(r: Rng, bound: number): number {
  if (bound <= 0) {
    throw new Error(`rng.nextInt: bound must be positive, got ${bound}`);
  }
  return Math.floor(nextFloat(r) * bound);
}

export function pick<T>(r: Rng, xs: readonly T[]): T {
  if (xs.length === 0) {
    throw new Error('rng.pick: cannot pick from an empty list');
  }
  return xs[nextInt(r, xs.length)]!;
}

/** Fisher-Yates, in place, consuming one draw per swap. */
export function shuffle<T>(r: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    const tmp = xs[i]!;
    xs[i] = xs[j]!;
    xs[j] = tmp;
  }
  return xs;
}
