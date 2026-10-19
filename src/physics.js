// Absurd physics engine: bespoke comedy physics for punched cars.
// Cheap rigid body integration with scripted exaggeration, no physics
// library. Punched cars launch, tumble, bounce with squash at least once,
// and shed debris. Pooled particles keep the frame rate steady.

import * as THREE from 'three';

const GRAVITY = 16;
const DEBRIS_POOL = 48;

export class AbsurdPhysics {
  constructor(scene, road) {
    this.scene = scene;
    this.road = road;
    this.tumblers = [];
    this.debris = [];
    this.onLaunch = null; // (magnitude) => main triggers hit-stop and shake
    this.buildDebrisPool();
  }

  buildDebrisPool() {
    const boxG = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const capG = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 10);
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.8 });
    const grayM = new THREE.MeshStandardMaterial({ color: 0x777d84, roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < DEBRIS_POOL; i++) {
      const isCap = i % 4 === 0;
      const mesh = new THREE.Mesh(isCap ? capG : boxG, isCap ? grayM : darkM);
      mesh.visible = false;
      this.scene.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), life: 0, active: false });
    }
  }

  spawnDebris(x, y, z, n) {
    let spawned = 0;
    for (const d of this.debris) {
      if (spawned >= n) break;
      if (d.active) continue;
      d.active = true;
      d.life = 1.4 + Math.random() * 0.5;
      d.mesh.visible = true;
      d.mesh.position.set(x + (Math.random() - 0.5), y + Math.random() * 0.5, z + (Math.random() - 0.5));
      d.vel.set((Math.random() - 0.5) * 10, 3 + Math.random() * 6, (Math.random() - 0.5) * 10);
      d.angVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      spawned++;
    }
  }

  // Launch a car mesh after a connected punch. dirX is the punch side
  // (-1 left, +1 right); quality 0..1 scales the spectacle.
  launch(mesh, dirX, quality) {
    const p = mesh.position;
    const tumbler = {
      mesh,
      vel: new THREE.Vector3(
        dirX * (7 + Math.random() * 4 + 3 * quality),
        9 + Math.random() * 5 + 4 * quality,
        -4 + Math.random() * 6
      ),
      angVel: new THREE.Vector3(
        (4 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1),
        (4 + Math.random() * 6) * (Math.random() < 0.5 ? -1 : 1),
        (4 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1)
      ),
      bounces: 0,
      restT: 0,
      squashT: 0,
      baseScale: mesh.scale.clone(),
    };
    this.tumblers.push(tumbler);
    this.spawnDebris(p.x, p.y + 0.6, p.z, 6 + Math.floor(quality * 5));
    if (this.onLaunch) this.onLaunch(0.6 + quality * 0.4);
  }

  update(dt) {
    // tumbling cars
    for (let i = this.tumblers.length - 1; i >= 0; i--) {
      const t = this.tumblers[i];
      const m = t.mesh;
      t.vel.y -= GRAVITY * dt;
      m.position.addScaledVector(t.vel, dt);
      m.rotation.x += t.angVel.x * dt;
      m.rotation.y += t.angVel.y * dt;
      m.rotation.z += t.angVel.z * dt;

      const groundY = this.road.roadY(m.position.z) + 0.5;
      if (m.position.y <= groundY) {
        m.position.y = groundY;
        if (Math.abs(t.vel.y) > 3 && t.bounces < 4) {
          // bounce with squash, at least once and up to a few times
          t.bounces++;
          t.vel.y *= -0.45;
          t.vel.x *= 0.7;
          t.vel.z *= 0.7;
          t.angVel.multiplyScalar(0.6);
          t.squashT = 0.15;
          this.spawnDebris(m.position.x, groundY + 0.3, m.position.z, 3);
        } else {
          // rolling to rest
          t.vel.y = 0;
          t.vel.x *= 1 - Math.min(1, dt * 3);
          t.vel.z *= 1 - Math.min(1, dt * 3);
          t.angVel.multiplyScalar(1 - Math.min(1, dt * 2.5));
          const sp = Math.hypot(t.vel.x, t.vel.z);
          if (sp < 1.2) {
            t.restT += dt;
            if (t.restT > 6) {
              this.scene.remove(m);
              m.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
              });
              this.tumblers.splice(i, 1);
              continue;
            }
          }
        }
      }

      // squash recovery
      if (t.squashT > 0) {
        t.squashT -= dt;
        const k = Math.max(0, t.squashT / 0.15);
        m.scale.set(t.baseScale.x * (1 + 0.18 * k), t.baseScale.y * (1 - 0.45 * k), t.baseScale.z * (1 + 0.18 * k));
        if (t.squashT <= 0) m.scale.copy(t.baseScale);
      }
    }

    // debris
    for (const d of this.debris) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.vel.y -= GRAVITY * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.angVel.x * dt;
      d.mesh.rotation.y += d.angVel.y * dt;
      d.mesh.rotation.z += d.angVel.z * dt;
      const gy = this.road.roadY(d.mesh.position.z) + 0.08;
      if (d.mesh.position.y < gy) {
        d.mesh.position.y = gy;
        d.vel.y *= -0.4;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
      }
    }
  }

  reset() {
    for (const t of this.tumblers) {
      this.scene.remove(t.mesh);
    }
    this.tumblers = [];
    for (const d of this.debris) {
      d.active = false;
      d.mesh.visible = false;
    }
  }
}
