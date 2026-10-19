// Seeded endless highway for Punch Rider.
// 60 m chunks along -Z, 3 lanes of 3.5 m, gentle curves and elevation.
// All geometry derives from (seed, chunkIndex) through closed-form analytic
// functions, so chunk borders are seamless and the same seed always builds
// the same road. Roadside scenery lives in a "splat corridor" subgroup that
// a future baked splat capture can replace at the same alignment.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hashInts, range, clamp, smoothstep } from './rng.js';

export const CHUNK_LENGTH = 60;
export const LANES = 3;
export const LANE_WIDTH = 3.5;
export const ROAD_HALF = (LANES * LANE_WIDTH) / 2; // 5.25
export const SHOULDER = 1.4;
export const CHUNKS_AHEAD = 5;
export const CHUNKS_BEHIND = 2;
export const CORRIDOR_START = ROAD_HALF + SHOULDER + 1; // procedural scenery begins here

export function chunkIndexForZ(z) {
  return Math.floor(-z / CHUNK_LENGTH);
}

export function chunkCenterZ(i) {
  return -(i * CHUNK_LENGTH + CHUNK_LENGTH / 2);
}

// Road shape parameters, derived once per seed. Gentle by design: total
// lateral slope stays well under 0.4 so 140 km/h still feels controllable.
function shapeParams(seed) {
  const rng = mulberry32(hashInts(seed, 0xC0FFEE));
  return {
    a1: range(rng, 15, 30), f1: range(rng, 0.003, 0.006), p1: range(rng, 0, Math.PI * 2),
    a2: range(rng, 4, 9), f2: range(rng, 0.01, 0.02), p2: range(rng, 0, Math.PI * 2),
    e1: range(rng, 2, 5), g1: range(rng, 0.003, 0.007), q1: range(rng, 0, Math.PI * 2),
    e2: range(rng, 0.8, 2), g2: range(rng, 0.012, 0.025), q2: range(rng, 0, Math.PI * 2),
  };
}

function groundNoise(x, z) {
  return Math.sin(x * 0.11 + z * 0.13) * 0.5 + Math.sin(x * 0.031 - z * 0.047 + 1.7) * 1.1;
}

// ---------------------------------------------------------------------------
// Shared materials and textures (module level, never disposed per chunk).
// ---------------------------------------------------------------------------

function makeAsphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#232328';
  g.fillRect(0, 0, 128, 512);
  // speckle
  for (let i = 0; i < 900; i++) {
    const v = 30 + Math.random() * 22;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 128, Math.random() * 512, 2, 2);
  }
  // solid edge lines
  g.fillStyle = '#c9c9c9';
  g.fillRect(5, 0, 4, 512);
  g.fillRect(119, 0, 4, 512);
  // dashed lane dividers: 3 m dash in a 12 m tile
  g.fillRect(41, 0, 4, 128);
  g.fillRect(83, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,190,110,1)');
  grad.addColorStop(0.4, 'rgba(255,150,60,0.5)');
  grad.addColorStop(1, 'rgba(255,140,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let MAT = null;
function sharedMaterials() {
  if (MAT) return MAT;
  MAT = {
    asphalt: new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.94, metalness: 0 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.7, metalness: 0.4 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.5 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x443c30, emissive: 0xffa64d, emissiveIntensity: 2.2 }),
    glow: new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    pine: new THREE.MeshStandardMaterial({ color: 0x1d3a24, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }),
    bush: new THREE.MeshStandardMaterial({ color: 0x2a4a2c, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x5c5c60, roughness: 0.95, flatShading: true }),
  };
  return MAT;
}

// ---------------------------------------------------------------------------
// Road class
// ---------------------------------------------------------------------------

export class Road {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.shape = shapeParams(this.seed);
    this.chunks = new Map(); // chunkIndex -> { group, scenery }
    this.overrides = new Map(); // chunkIndex -> splat object (future corridor replacement)
    this.mat = sharedMaterials();
  }

  centerX(z) {
    const s = this.shape;
    return s.a1 * Math.sin(z * s.f1 + s.p1) + s.a2 * Math.sin(z * s.f2 + s.p2);
  }

  roadY(z) {
    const s = this.shape;
    return s.e1 * Math.sin(z * s.g1 + s.q1) + s.e2 * Math.sin(z * s.g2 + s.q2);
  }

  // Alias kept for the splat landmark manager: lateral position of the road center.
  pathX(z) {
    return this.centerX(z);
  }

  laneCenterX(lane, z) {
    return this.centerX(z) + (lane - 1) * LANE_WIDTH;
  }

  heightAt(x, z) {
    const cx = this.centerX(z);
    const dx = Math.abs(x - cx);
    const ry = this.roadY(z);
    const edge = ROAD_HALF + SHOULDER;
    if (dx <= edge) return ry;
    const t = dx - edge;
    return ry - t * 0.09 - smoothstep(0, 40, t) * 6 + groundNoise(x, z) * smoothstep(2, 25, t);
  }

  // Splat corridor seam: the world-space box where procedural scenery lives
  // and where a future baked splat capture can take over at the same alignment.
  corridorBounds(chunkIndex) {
    const zc = chunkCenterZ(chunkIndex);
    const cx = this.centerX(zc);
    return {
      minX: cx - 80, maxX: cx + 80,
      minZ: zc - CHUNK_LENGTH / 2, maxZ: zc + CHUNK_LENGTH / 2,
      groundY: this.roadY(zc),
    };
  }

  // Register or clear a splat object that replaces procedural scenery for a chunk.
  setSceneryOverride(chunkIndex, obj) {
    const rec = this.chunks.get(chunkIndex);
    if (obj) this.overrides.set(chunkIndex, obj);
    else this.overrides.delete(chunkIndex);
    if (rec) this.applyOverride(rec, chunkIndex);
  }

  applyOverride(rec, chunkIndex) {
    const obj = this.overrides.get(chunkIndex);
    rec.scenery.visible = !obj;
    if (obj && obj.parent !== rec.group) rec.group.add(obj);
    if (!obj) {
      for (const child of [...rec.group.children]) {
        if (child.userData.isSceneryOverride) rec.group.remove(child);
      }
    }
  }

  update(riderZ) {
    const ci = chunkIndexForZ(riderZ);
    for (let i = ci - CHUNKS_BEHIND; i <= ci + CHUNKS_AHEAD; i++) {
      if (i >= 0 && !this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [i, rec] of this.chunks) {
      if (i < ci - CHUNKS_BEHIND || i > ci + CHUNKS_AHEAD) this.disposeChunk(i, rec);
    }
  }

  buildChunk(i) {
    const group = new THREE.Group();
    group.userData.chunkIndex = i;
    const scenery = new THREE.Group(); // splat corridor: replaceable later
    group.add(scenery);
    const rng = mulberry32(hashInts(this.seed, i, 0x60AD));
    const m = this.mat;

    this.buildRoadRibbon(group, i);
    this.buildGuardrails(group, i);
    this.buildLights(scenery, i, rng);
    this.buildTerrain(scenery, i, rng);
    this.buildVegetation(scenery, i, rng);

    const rec = { group, scenery };
    this.chunks.set(i, rec);
    this.applyOverride(rec, i);
    this.scene.add(group);
  }

  ribbonGeometry(i, halfWidth, yOff, vRepeat) {
    const SEG = 20;
    const pos = [];
    const uv = [];
    const idx = [];
    const zTop = -(i * CHUNK_LENGTH);
    for (let s = 0; s <= SEG; s++) {
      const z = zTop - (s / SEG) * CHUNK_LENGTH;
      const cx = this.centerX(z);
      const y = this.roadY(z) + yOff;
      pos.push(cx - halfWidth, y, z, cx + halfWidth, y, z);
      uv.push(0, (s / SEG) * vRepeat, 1, (s / SEG) * vRepeat);
      if (s < SEG) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildRoadRibbon(group, i) {
    const geo = this.ribbonGeometry(i, ROAD_HALF + SHOULDER, 0.02, 5);
    group.add(new THREE.Mesh(geo, this.mat.asphalt));
  }

  buildGuardrails(group, i) {
    const m = this.mat;
    for (const side of [-1, 1]) {
      const off = side * (ROAD_HALF + SHOULDER + 0.5);
      group.add(new THREE.Mesh(this.offsetRibbon(i, off, 0.75, 0.35), m.rail));
      const posts = [];
      for (let k = 0; k <= 10; k++) {
        const z = -(i * CHUNK_LENGTH) - k * 6;
        const g = new THREE.BoxGeometry(0.14, 0.75, 0.14);
        g.translate(this.centerX(z) + off, this.roadY(z) + 0.37, z);
        posts.push(g);
      }
      group.add(new THREE.Mesh(mergeGeometries(posts), m.post));
      posts.forEach((g) => g.dispose());
    }
  }

  // Narrow vertical strip at a lateral offset, used for guardrails.
  offsetRibbon(i, lateralOff, yTop, yBottom) {
    const SEG = 20;
    const pos = [];
    const idx = [];
    const zTop = -(i * CHUNK_LENGTH);
    for (let s = 0; s <= SEG; s++) {
      const z = zTop - (s / SEG) * CHUNK_LENGTH;
      const x = this.centerX(z) + lateralOff;
      const y = this.roadY(z);
      pos.push(x, y + yTop, z, x, y + yBottom, z);
      if (s < SEG) {
        const a = s * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildLights(scenery, i, rng) {
    const m = this.mat;
    const poles = [];
    const heads = [];
    const glows = [];
    for (let k = 0; k < 2; k++) {
      const z = -(i * CHUNK_LENGTH) - 12 - k * 30;
      const side = (i + k) % 2 === 0 ? 1 : -1;
      const x = this.centerX(z) + side * (ROAD_HALF + SHOULDER + 1.2);
      const y = this.roadY(z);
      const pole = new THREE.CylinderGeometry(0.09, 0.12, 7, 6);
      pole.translate(x, y + 3.5, z);
      poles.push(pole);
      const arm = new THREE.BoxGeometry(1.8, 0.1, 0.1);
      arm.translate(x - side * 0.8, y + 6.9, z);
      poles.push(arm);
      const head = new THREE.BoxGeometry(0.7, 0.18, 0.3);
      head.translate(x - side * 1.6, y + 6.85, z);
      heads.push(head);
      const spr = new THREE.Sprite(m.glow);
      spr.position.set(x - side * 1.6, y + 6.7, z);
      spr.scale.set(4, 4, 1);
      glows.push(spr);
    }
    scenery.add(new THREE.Mesh(mergeGeometries(poles), m.pole));
    scenery.add(new THREE.Mesh(mergeGeometries(heads), m.lampHead));
    glows.forEach((s) => scenery.add(s));
    poles.forEach((g) => g.dispose());
    heads.forEach((g) => g.dispose());
  }

  buildTerrain(scenery, i, rng) {
    const m = this.mat;
    const zc = chunkCenterZ(i);
    const cx = this.centerX(zc);
    for (const side of [-1, 1]) {
      const W = 80;
      const geo = new THREE.PlaneGeometry(W, CHUNK_LENGTH, 10, 16);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      const colors = [];
      const cA = new THREE.Color(0x2b4426);
      const cB = new THREE.Color(0x3a3a2e);
      const tmp = new THREE.Color();
      for (let v = 0; v < p.count; v++) {
        const lx = p.getX(v);
        const lz = p.getZ(v);
        const wx = cx + side * (CORRIDOR_START + W / 2) + lx;
        const wz = zc + lz;
        p.setY(v, this.heightAt(wx, wz)); // world Y, mesh positioned at origin
        const n = 0.5 + 0.5 * Math.sin(wx * 0.05 + wz * 0.07 + i);
        tmp.copy(cA).lerp(cB, clamp(n + range(rng, -0.15, 0.15), 0, 1));
        colors.push(tmp.r, tmp.g, tmp.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, m.terrain);
      scenery.add(mesh);
    }
  }

  buildVegetation(scenery, i, rng) {
    const m = this.mat;
    const zTop = -(i * CHUNK_LENGTH);
    const dummy = new THREE.Object3D();

    // Pines: merged trunk + cone, instanced.
    const trunkG = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5);
    trunkG.translate(0, 0.6, 0);
    const coneG = new THREE.ConeGeometry(1.1, 2.8, 7);
    coneG.translate(0, 2.4, 0);
    const pineG = mergeGeometries([trunkG, coneG]);
    trunkG.dispose();
    coneG.dispose();
    const pines = new THREE.InstancedMesh(pineG, m.pine, 34);
    let n = 0;
    for (let k = 0; k < 34; k++) {
      const z = zTop - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const x = this.centerX(z) + side * range(rng, 12, 68);
      const s = range(rng, 0.8, 1.7);
      dummy.position.set(x, this.heightAt(x, z), z);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = rng() * Math.PI * 2;
      dummy.updateMatrix();
      pines.setMatrixAt(n++, dummy.matrix);
    }
    pines.instanceMatrix.needsUpdate = true;
    scenery.add(pines);

    // Bushes and rocks, instanced.
    const bushG = new THREE.IcosahedronGeometry(0.7, 0);
    const bushes = new THREE.InstancedMesh(bushG, m.bush, 18);
    n = 0;
    for (let k = 0; k < 18; k++) {
      const z = zTop - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const x = this.centerX(z) + side * range(rng, 9, 55);
      const s = range(rng, 0.6, 1.6);
      dummy.position.set(x, this.heightAt(x, z) + 0.3 * s, z);
      dummy.scale.set(s, s * 0.75, s);
      dummy.rotation.y = rng() * Math.PI * 2;
      dummy.updateMatrix();
      bushes.setMatrixAt(n++, dummy.matrix);
    }
    bushes.instanceMatrix.needsUpdate = true;
    scenery.add(bushes);

    const rockG = new THREE.DodecahedronGeometry(0.6, 0);
    const rocks = new THREE.InstancedMesh(rockG, m.rock, 10);
    n = 0;
    for (let k = 0; k < 10; k++) {
      const z = zTop - rng() * CHUNK_LENGTH;
      const side = rng() < 0.5 ? -1 : 1;
      const x = this.centerX(z) + side * range(rng, 8, 40);
      const s = range(rng, 0.5, 1.4);
      dummy.position.set(x, this.heightAt(x, z) + 0.15, z);
      dummy.scale.set(s, s * 0.7, s);
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      dummy.updateMatrix();
      rocks.setMatrixAt(n++, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    scenery.add(rocks);
  }

  disposeChunk(i, rec) {
    this.chunks.delete(i);
    this.scene.remove(rec.group);
    rec.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // Materials are shared module-level, never disposed here.
      // Sprites share the glow material too.
    });
  }

  dispose() {
    for (const [i, rec] of this.chunks) this.disposeChunk(i, rec);
  }
}
