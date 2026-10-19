// Landmark manager: baked gaussian splat captures placed along the highway.
// Splats are loaded from public/splats/manifest.json. Each entry pins a baked
// capture file to a chunk index plus a lateral offset from the road center.
// If a file is missing or fails to load, a procedural glowing obelisk takes its
// place and a warning is logged. The game never crashes on a bad splat.
// Roadside chunks are structured as splat corridors, so a future capture can
// replace the procedural scenery per the splat world platform spec.

import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { chunkCenterZ, chunkIndexForZ } from './road.js';

const LOAD_RADIUS_CHUNKS = 2;
const LOAD_TIMEOUT_MS = 20000;

export class SplatManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.entries = [];
    this.loaded = new Map(); // id -> { state, object }
  }

  async init() {
    try {
      const res = await fetch('splats/manifest.json');
      if (!res.ok) {
        console.warn(`[splats] manifest not found (HTTP ${res.status}), landmarks disabled`);
        return;
      }
      const data = await res.json();
      this.entries = data.landmarks || [];
      console.info(`[splats] ${this.entries.length} landmark(s) registered`);
    } catch (err) {
      console.warn('[splats] could not read manifest, landmarks disabled:', err.message);
    }
  }

  update(playerZ) {
    const playerChunk = chunkIndexForZ(playerZ);
    for (const entry of this.entries) {
      const near = Math.abs(entry.chunkIndex - playerChunk) <= LOAD_RADIUS_CHUNKS;
      const rec = this.loaded.get(entry.id);
      if (near && !rec) this.loadOne(entry);
      if (!near && rec && rec.state !== 'loading') this.unloadOne(entry);
    }
  }

  async loadOne(entry) {
    this.loaded.set(entry.id, { state: 'loading', object: null });
    try {
      // Cheap existence check before asking Spark to parse the file.
      const head = await fetch(entry.file, { method: 'HEAD' });
      if (!head.ok) throw new Error(`HTTP ${head.status} for ${entry.file}`);

      const mesh = new SplatMesh({ url: entry.file });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('load timeout')), LOAD_TIMEOUT_MS)
      );
      await Promise.race([mesh.initialized, timeout]);

      // The player may have walked away while we were loading.
      if (!this.loaded.has(entry.id)) {
        this.scene.remove(mesh);
        return;
      }
      this.place(entry, mesh);
      this.loaded.set(entry.id, { state: 'ready', object: mesh });
      console.info(`[splats] landmark ready: ${entry.id}`);
    } catch (err) {
      if (!this.loaded.has(entry.id)) return; // unloaded mid-load, stay quiet
      console.warn(`[splats] Could not load "${entry.file}", using placeholder. ${err.message}`);
      const placeholder = this.makePlaceholder(entry);
      this.place(entry, placeholder);
      this.loaded.set(entry.id, { state: 'placeholder', object: placeholder });
    }
  }

  place(entry, obj) {
    const zc = chunkCenterZ(entry.chunkIndex) + (entry.offset?.z || 0);
    const x = this.world.pathX(zc) + (entry.offset?.x || 0);
    const y = this.world.heightAt(x, zc) + (entry.offset?.y || 0);
    obj.position.set(x, y, zc);
    this.scene.add(obj);
  }

  makePlaceholder(entry) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2f3a,
      emissive: 0xffb347,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.1,
    });
    const obelisk = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), mat);
    obelisk.scale.set(1, 3.2, 1);
    obelisk.position.y = 4.6;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.4, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 })
    );
    base.position.y = 0.4;
    group.add(obelisk, base);
    group.userData.isPlaceholder = true;
    group.userData.landmarkId = entry.id;
    return group;
  }

  unloadOne(entry) {
    const rec = this.loaded.get(entry.id);
    this.loaded.delete(entry.id);
    if (rec && rec.object) {
      this.scene.remove(rec.object);
      // Only dispose geometries we created ourselves (placeholders).
      // SplatMesh owns its GPU resources through Spark, so just detach it.
      if (rec.object.userData.isPlaceholder) {
        rec.object.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
    }
  }
}
