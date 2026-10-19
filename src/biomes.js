// Biome definitions: visual identity for each region type the trail passes through.
// A biome owns its palette (sky, fog, ground gradient, path), atmosphere and
// vegetation density. Chunks pick a biome deterministically from the seed.

import { mulberry32 } from './rng.js';
import { hashInts } from './rng.js';

export const BIOMES = {
  forest: {
    name: 'Forest',
    skyTop: 0x3d6b8f,
    skyBottom: 0xcfe3d8,
    fogColor: 0x9db8a8,
    fogDensity: 0.0075,
    groundLow: 0x2e4a2a,
    groundHigh: 0x5d7a44,
    path: 0x8a7355,
    treeColor: 0x2f5d33,
    trunkColor: 0x4a3524,
    treeDensity: 1.0,
    rockDensity: 0.4,
    sunColor: 0xffe6b8,
    sunIntensity: 1.1,
  },
  meadow: {
    name: 'Meadow',
    skyTop: 0x4f8fd0,
    skyBottom: 0xe8f2e0,
    fogColor: 0xbcd4c8,
    fogDensity: 0.005,
    groundLow: 0x4c7a3a,
    groundHigh: 0x8fb45c,
    path: 0x9a8a68,
    treeColor: 0x3f7040,
    trunkColor: 0x54402c,
    treeDensity: 0.35,
    rockDensity: 0.25,
    sunColor: 0xfff2cc,
    sunIntensity: 1.25,
  },
  desert: {
    name: 'Desert',
    skyTop: 0x3f7fc0,
    skyBottom: 0xf6ddae,
    fogColor: 0xe8c890,
    fogDensity: 0.006,
    groundLow: 0xb98a4e,
    groundHigh: 0xe6c078,
    path: 0xd8b070,
    treeColor: 0x6a7a3a,
    trunkColor: 0x6b5236,
    treeDensity: 0.08,
    rockDensity: 0.7,
    sunColor: 0xffe0a0,
    sunIntensity: 1.5,
  },
  canyon: {
    name: 'Canyon',
    skyTop: 0x35507e,
    skyBottom: 0xe8b890,
    fogColor: 0xc89878,
    fogDensity: 0.007,
    groundLow: 0x7a4430,
    groundHigh: 0xb8704a,
    path: 0xc09060,
    treeColor: 0x4a5a30,
    trunkColor: 0x4a3524,
    treeDensity: 0.15,
    rockDensity: 1.0,
    sunColor: 0xffd0a0,
    sunIntensity: 1.3,
  },
  snowfield: {
    name: 'Snowfield',
    skyTop: 0x5a7fa8,
    skyBottom: 0xe8eef4,
    fogColor: 0xd8e2ec,
    fogDensity: 0.009,
    groundLow: 0x9aa8b8,
    groundHigh: 0xf0f4f8,
    path: 0xc8d0d8,
    treeColor: 0x2a4a3a,
    trunkColor: 0x3a2e22,
    treeDensity: 0.3,
    rockDensity: 0.5,
    sunColor: 0xe8f0ff,
    sunIntensity: 1.0,
  },
};

export const BIOME_ORDER = ['forest', 'meadow', 'desert', 'canyon', 'snowfield'];

// Deterministic biome schedule: the world is divided into segments of 6-12
// chunks, each with a different biome than the previous one.
export function biomeKeyForChunkIndex(seed, chunkIndex) {
  const rng = mulberry32(hashInts(seed, 0xb10e55));
  let start = 0;
  let current = BIOME_ORDER[Math.floor(rng() * BIOME_ORDER.length)];
  for (let guard = 0; guard < 100000; guard++) {
    const len = 6 + Math.floor(rng() * 7); // 6..12 chunks per biome segment
    if (chunkIndex < start + len) return current;
    start += len;
    let next = current;
    while (next === current) next = BIOME_ORDER[Math.floor(rng() * BIOME_ORDER.length)];
    current = next;
  }
  return current; // unreachable guard fallback
}

export function biomeForChunkIndex(seed, chunkIndex) {
  return BIOMES[biomeKeyForChunkIndex(seed, chunkIndex)];
}
