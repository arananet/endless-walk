// Chunked infinite world.
// The world is a sequence of chunks along the -Z axis. Each chunk is fully
// deterministic from (seed, chunkIndex): terrain heightfield, a curving walkable
// path, and instanced vegetation/rocks. Chunks ahead of the player are generated
// on demand, chunks behind are disposed.
// The height function is analytic (closed form), so the player ground clamp and
// the splat manager can query terrain height without any mesh sampling.

import * as THREE from 'three';
import { mulberry32, hashInts, clamp, smoothstep, range } from './rng.js';
import { biomeForChunkIndex } from './biomes.js';

export const CHUNK_LENGTH = 60;
export const CHUNK_WIDTH = 96;
export const CHUNKS_AHEAD = 4;
export const CHUNKS_BEHIND = 1;

export function chunkIndexForZ(z) {
  return Math.max(0, Math.floor(-z / CHUNK_LENGTH));
}

export function chunkCenterZ(chunkIndex) {
  return -(chunkIndex * CHUNK_LENGTH + CHUNK_LENGTH / 2);
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.chunks = new Map();

    this.group = new THREE.Group();
    scene.add(this.group);

    // Atmosphere follows the biome the player is standing in, crossfaded.
    this.scene.fog = new THREE.FogExp2(0x9db8a8, 0.0075);
    this.scene.background = new THREE.Color(0x9db8a8);

    this.hemi = new THREE.HemisphereLight(0xcfe3d8, 0x2e4a2a, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe6b8, 1.1);
    scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // Scratch objects to avoid per-frame allocation.
    this._fogColor = new THREE.Color();
    this._bgColor = new THREE.Color();
    this._skyColor = new THREE.Color();
    this._groundColor = new THREE.Color();
    this._c1 = new THREE.Color();
    this._c2 = new THREE.Color();

    // Shared low-poly assets reused by every chunk's instanced meshes.
    this.trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 2.6, 6);
    this.trunkGeo.translate(0, 1.3, 0);
    this.canopyGeo = new THREE.ConeGeometry(1.9, 4.2, 7);
    this.canopyGeo.translate(0, 4.4, 0);
    this.rockGeo = new THREE.IcosahedronGeometry(0.9, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.canopyMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.rockMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    this.pathMat = new THREE.MeshStandardMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  // Lateral position of the path at each chunk boundary (z = -i * CHUNK_LENGTH).
  // Chunk 0 starts straight ahead so the spawn view is clean.
  pathBoundaryX(i) {
    if (i <= 0) return 0;
    const rng = mulberry32(hashInts(this.seed, i, 0x51f7));
    return (rng() * 2 - 1) * 13;
  }

  // Smooth path centerline via Catmull-Rom over the boundary points.
  pathX(z) {
    const t = -z / CHUNK_LENGTH;
    const i = Math.floor(t);
    const f = t - i;
    const p0 = this.pathBoundaryX(i - 1);
    const p1 = this.pathBoundaryX(i);
    const p2 = this.pathBoundaryX(i + 1);
    const p3 = this.pathBoundaryX(i + 2);
    const f2 = f * f;
    const f3 = f2 * f;
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
  }

  // Deterministic value noise, two uses: terrain detail and path base height.
  valueNoise(x, z, cell, salt) {
    const xi = Math.floor(x / cell);
    const zi = Math.floor(z / cell);
    const xf = x / cell - xi;
    const zf = z / cell - zi;
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    const h = (a, b) => hashInts(this.seed ^ salt, a, b) / 4294967296;
    const a = h(xi, zi);
    const b = h(xi + 1, zi);
    const c = h(xi, zi + 1);
    const d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // Gentle long-wavelength undulation the path corridor follows.
  pathBaseY(z) {
    return (this.valueNoise(0, z, 45, 0x9e37) - 0.5) * 10;
  }

  roughHeight(x, z) {
    return (
      (this.valueNoise(x, z, 11, 0x1234) - 0.5) * 12 +
      (this.valueNoise(x, z, 29, 0x5678) - 0.5) * 5
    );
  }

  // Analytic terrain height. Near the path the terrain flattens toward the
  // path base height so the trail is always walkable.
  heightAt(x, z) {
    const px = this.pathX(z);
    const d = Math.abs(x - px);
    const base = this.pathBaseY(z);
    return base + (this.roughHeight(x, z) - base) * smoothstep(2.5, 11, d);
  }

  biomeAtZ(z) {
    return biomeForChunkIndex(this.seed, chunkIndexForZ(z));
  }

  // ---- chunk construction -------------------------------------------------

  buildChunk(index) {
    const biome = biomeForChunkIndex(this.seed, index);
    const zc = chunkCenterZ(index);
    const group = new THREE.Group();
    const disposables = [];

    // Terrain: displaced plane with per-vertex biome colors.
    const segX = 56;
    const segZ = 40;
    const terrainGeo = new THREE.PlaneGeometry(CHUNK_WIDTH, CHUNK_LENGTH, segX, segZ);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    this._c1.set(biome.groundLow);
    this._c2.set(biome.groundHigh);
    const pathCol = new THREE.Color(biome.path);
    for (let v = 0; v < pos.count; v++) {
      const lx = pos.getX(v);
      const lz = pos.getZ(v);
      const wz = zc + lz;
      const y = this.heightAt(lx, wz);
      pos.setY(v, y);
      const t = smoothstep(-6, 8, y);
      this._groundColor.copy(this._c1).lerp(this._c2, t);
      const variation = 0.9 + this.valueNoise(lx, wz, 3.7, 0xab1e) * 0.2;
      this._groundColor.multiplyScalar(variation);
      // Tint the ground toward the path color right at the trail.
      const dPath = Math.abs(lx - this.pathX(wz));
      if (dPath < 3.2) this._groundColor.lerp(pathCol, 1 - smoothstep(1.2, 3.2, dPath));
      colors[v * 3] = this._groundColor.r;
      colors[v * 3 + 1] = this._groundColor.g;
      colors[v * 3 + 2] = this._groundColor.b;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
    );
    terrain.position.z = zc;
    group.add(terrain);
    disposables.push(terrainGeo, terrain.material);

    // Path ribbon following the centerline, slightly above the terrain.
    const ribbon = this.buildPathRibbon(index, zc, biome);
    group.add(ribbon.mesh);
    disposables.push(ribbon.geo, ribbon.mat);

    // Vegetation and rocks as instanced meshes, kept clear of the trail.
    const rng = mulberry32(hashInts(this.seed, index, 0x7cee));
    const flora = this.buildFlora(index, zc, biome, rng);
    for (const m of flora) {
      group.add(m);
      disposables.push(m); // InstancedMesh.dispose() frees instance buffers
    }

    this.group.add(group);
    this.chunks.set(index, { group, disposables });
  }

  buildPathRibbon(index, zc, biome) {
    const segments = 30;
    const halfW = 1.7;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const idx = [];
    for (let s = 0; s <= segments; s++) {
      const lz = -CHUNK_LENGTH / 2 + (s / segments) * CHUNK_LENGTH;
      const wz = zc + lz;
      const px = this.pathX(wz);
      const y = this.heightAt(px, wz) + 0.07;
      const o = s * 6;
      positions[o] = px - halfW; positions[o + 1] = y; positions[o + 2] = lz;
      positions[o + 3] = px + halfW; positions[o + 4] = y; positions[o + 5] = lz;
      if (s < segments) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = this.pathMat.clone();
    mat.color.set(biome.path);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = zc;
    return { mesh, geo, mat };
  }

  buildFlora(index, zc, biome, rng) {
    const meshes = [];
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    const placeOnGround = (mesh, i, x, wz, s, sy, rotY) => {
      const y = this.heightAt(x, wz);
      dummy.position.set(x, y - 0.1, wz);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(s, sy, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    };

    // Trees: trunk + canopy instanced meshes sharing one transform list.
    const treeCount = Math.round(biome.treeDensity * 34);
    if (treeCount > 0) {
      const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, treeCount);
      const canopies = new THREE.InstancedMesh(this.canopyGeo, this.canopyMat, treeCount);
      let placed = 0;
      for (let attempt = 0; attempt < treeCount * 12 && placed < treeCount; attempt++) {
        const x = range(rng, -CHUNK_WIDTH / 2 + 4, CHUNK_WIDTH / 2 - 4);
        const wz = zc + range(rng, -CHUNK_LENGTH / 2, CHUNK_LENGTH / 2);
        if (Math.abs(x - this.pathX(wz)) < 5) continue;
        const s = range(rng, 0.7, 1.6);
        const rotY = rng() * Math.PI * 2;
        placeOnGround(trunks, placed, x, wz, s, s * range(rng, 0.9, 1.2), rotY);
        placeOnGround(canopies, placed, x, wz, s, s * range(rng, 0.9, 1.2), rotY);
        col.set(biome.treeColor).multiplyScalar(range(rng, 0.85, 1.15));
        canopies.setColorAt(placed, col);
        col.set(biome.trunkColor).multiplyScalar(range(rng, 0.9, 1.1));
        trunks.setColorAt(placed, col);
        placed++;
      }
      trunks.count = placed;
      canopies.count = placed;
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
      if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
      meshes.push(trunks, canopies);
    }

    // Rocks.
    const rockCount = Math.round(6 + biome.rockDensity * 14);
    const rocks = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rockCount);
    let rPlaced = 0;
    for (let attempt = 0; attempt < rockCount * 12 && rPlaced < rockCount; attempt++) {
      const x = range(rng, -CHUNK_WIDTH / 2 + 2, CHUNK_WIDTH / 2 - 2);
      const wz = zc + range(rng, -CHUNK_LENGTH / 2, CHUNK_LENGTH / 2);
      if (Math.abs(x - this.pathX(wz)) < 3.5) continue;
      const s = range(rng, 0.4, 1.7);
      placeOnGround(rocks, rPlaced, x, wz, s, s * range(rng, 0.55, 0.9), rng() * Math.PI * 2);
      col.set(0x8a8a8a).multiplyScalar(range(rng, 0.7, 1.1));
      rocks.setColorAt(rPlaced, col);
      rPlaced++;
    }
    rocks.count = rPlaced;
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    meshes.push(rocks);

    return meshes;
  }

  disposeChunk(index) {
    const rec = this.chunks.get(index);
    if (!rec) return;
    this.group.remove(rec.group);
    for (const d of rec.disposables) {
      if (d && typeof d.dispose === 'function') d.dispose();
    }
    this.chunks.delete(index);
  }

  // ---- per-frame ----------------------------------------------------------

  update(playerZ, dt, playerPos) {
    const playerChunk = chunkIndexForZ(playerZ);
    for (let i = playerChunk - CHUNKS_BEHIND; i <= playerChunk + CHUNKS_AHEAD; i++) {
      if (!this.chunks.has(i)) this.buildChunk(i);
    }
    for (const index of [...this.chunks.keys()]) {
      if (index < playerChunk - CHUNKS_BEHIND || index > playerChunk + CHUNKS_AHEAD) {
        this.disposeChunk(index);
      }
    }

    // Crossfade atmosphere toward the biome under the player.
    const biome = this.biomeAtZ(playerZ);
    const k = 1 - Math.exp(-dt * 1.6);
    this._fogColor.set(biome.fogColor);
    this.scene.fog.color.lerp(this._fogColor, k);
    this.scene.fog.density += (biome.fogDensity - this.scene.fog.density) * k;
    this._bgColor.set(biome.fogColor);
    this.scene.background.lerp(this._bgColor, k);
    this._skyColor.set(biome.skyTop);
    this.hemi.color.lerp(this._skyColor, k);
    this._groundColor.set(biome.groundLow);
    this.hemi.groundColor.lerp(this._groundColor, k);
    this._c1.set(biome.sunColor);
    this.sun.color.lerp(this._c1, k);
    this.sun.intensity += (biome.sunIntensity - this.sun.intensity) * k;

    // Keep the sun glued to the player so lighting stays consistent.
    if (playerPos) {
      this.sun.position.set(playerPos.x + 60, playerPos.y + 90, playerPos.z + 40);
      this.sunTarget.position.copy(playerPos);
    }
  }
}
