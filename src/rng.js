// Seeded PRNG and deterministic hashing utilities.
// Everything procedural in the game derives from these, so the same
// (seed, chunkIndex) always produces the same geometry.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a style mix of integer inputs into a single uint32.
// Used to derive per-chunk, per-lattice seeds from the global seed.
export function hashInts(...ints) {
  let h = 2166136261 >>> 0;
  for (const n of ints) {
    h ^= (n | 0) >>> 0;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
