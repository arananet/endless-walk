// First-person motorcycle rider: constant speed, lane steering, punch combat.
// The camera sits where the rider's head is; handlebars and arms are real
// meshes parented to the camera at the bottom of the frame. Punching is a
// procedural arm swing with a short active hitbox window.

import * as THREE from 'three';
import { clamp, lerp } from './rng.js';
import { ROAD_HALF } from './road.js';

export const RIDER_SPEED = 38; // m/s, reads like ~140 km/h with the FOV kick
export const EYE_HEIGHT = 1.35;
export const PUNCH_COOLDOWN = 0.35;
export const PUNCH_DURATION = 0.27;
export const PUNCH_LATERAL = 2.5; // hitbox reach on the punching side
export const PUNCH_AHEAD = 6; // hitbox forward extent (m)
export const PUNCH_BEHIND = 2; // hitbox rear extent (m)
export const MAX_HEALTH = 3;
export const INVULN_TIME = 1.5;

export class Rider {
  constructor(camera, canvas, road) {
    this.camera = camera;
    this.canvas = canvas;
    this.road = road;

    this.z = 0;
    this.lateral = 0; // offset from road center
    this.lateralVel = 0;
    this.speed = RIDER_SPEED;
    this.distance = 0;
    this.health = MAX_HEALTH;
    this.invuln = 0;
    this.cooldown = 0;
    this.dead = false;

    this.keys = {};
    this.touchSteer = 0;
    this.punchQueue = []; // sides punched this frame: -1 left, +1 right

    this.punchT = -1; // -1 idle, else 0..1 progress
    this.punchSide = 0;
    this.fovKick = 0;
    this.trauma = 0;
    this.wipeT = -1;

    this.buildCockpit();
    this.bindInput();
  }

  // -- cockpit: handlebars and arms parented to the camera ------------------
  buildCockpit() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.6, metalness: 0.4 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x8a2be2, roughness: 0.8 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.85 });

    this.cockpit = new THREE.Group();

    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8), dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, -0.30, -0.55);
    this.cockpit.add(bar);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), gripMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.28, -0.30, -0.55);
      grip.userData.side = s;
      grip.userData.isGrip = true;
      this.cockpit.add(grip);
      // mirror stalk + mirror
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), dark);
      stalk.position.set(s * 0.24, -0.20, -0.55);
      stalk.rotation.z = s * -0.3;
      this.cockpit.add(stalk);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.02), dark);
      mirror.position.set(s * 0.28, -0.12, -0.55);
      this.cockpit.add(mirror);
    }
    // small windscreen
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85 })
    );
    screen.position.set(0, -0.18, -0.62);
    screen.rotation.x = -0.35;
    this.cockpit.add(screen);

    // arms: shoulder pivots at the bottom corners of the frame
    this.arms = {};
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.30, -0.42, -0.25);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), jacketMat);
      upper.position.set(0, 0.05, -0.12);
      upper.rotation.x = 1.1;
      pivot.add(upper);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), gloveMat);
      fist.position.set(0, 0.10, -0.28);
      fist.userData.isFist = true;
      fist.userData.side = s;
      pivot.add(fist);
      pivot.userData.restFist = fist.position.clone();
      pivot.userData.side = s;
      this.cockpit.add(pivot);
      this.arms[s] = { pivot, fist };
    }

    this.camera.add(this.cockpit);
  }

  // -- input ----------------------------------------------------------------
  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyQ') this.tryPunch(-1);
      if (e.code === 'KeyE') this.tryPunch(1);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    // Click left/right half of the canvas to punch that side.
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.tryPunch(e.clientX < window.innerWidth / 2 ? -1 : 1);
    });
    // Touch: quick tap punches that half, drag steers.
    let t0 = 0, x0 = 0, y0 = 0, dragging = false;
    this.canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      t0 = performance.now();
      x0 = t.clientX; y0 = t.clientY;
      dragging = false;
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      if (Math.abs(dx) > 24) dragging = true;
      if (dragging) this.touchSteer = clamp(dx / 90, -1, 1);
    }, { passive: true });
    const endTouch = (e) => {
      const t = e.changedTouches[0];
      const dt = performance.now() - t0;
      const moved = Math.hypot(t.clientX - x0, t.clientY - y0);
      if (!dragging && dt < 220 && moved < 18) {
        this.tryPunch(t.clientX < window.innerWidth / 2 ? -1 : 1);
      }
      this.touchSteer = 0;
      dragging = false;
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  tryPunch(side) {
    if (this.dead || this.cooldown > 0) return false;
    this.cooldown = PUNCH_COOLDOWN;
    this.punchT = 0;
    this.punchSide = side;
    this.punchQueue.push(side);
    return true;
  }

  consumePunches() {
    const q = this.punchQueue;
    this.punchQueue = [];
    return q;
  }

  // World-space hitbox for a punch on the given side.
  hitbox(side) {
    const x = this.road.centerX(this.z) + this.lateral;
    const x0 = side < 0 ? x - PUNCH_LATERAL - 0.4 : x + 0.3;
    const x1 = side < 0 ? x - 0.3 : x + PUNCH_LATERAL + 0.4;
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), zNear: this.z - PUNCH_BEHIND, zFar: this.z - PUNCH_AHEAD };
  }

  damage() {
    if (this.dead || this.invuln > 0) return this.health;
    this.health -= 1;
    this.invuln = INVULN_TIME;
    this.trauma = 1;
    return this.health;
  }

  addTrauma(x) {
    this.trauma = clamp(this.trauma + x, 0, 1);
  }

  get x() {
    return this.road.centerX(this.z) + this.lateral;
  }

  reset() {
    this.z = 0;
    this.lateral = 0;
    this.lateralVel = 0;
    this.distance = 0;
    this.health = MAX_HEALTH;
    this.invuln = 0;
    this.cooldown = 0;
    this.dead = false;
    this.punchT = -1;
    this.wipeT = -1;
    this.trauma = 0;
    this.fovKick = 0;
    this.punchQueue = [];
  }

  startWipeout() {
    this.dead = true;
    this.wipeT = 0;
  }

  // Returns true when the wipeout animation finished.
  updateWipeout(dt) {
    this.wipeT += dt;
    const t = clamp(this.wipeT / 1.4, 0, 1);
    const cx = this.road.centerX(this.z);
    const ry = this.road.roadY(this.z);
    // tumble: roll spins, camera drops toward the asphalt
    this.camera.position.set(cx + this.lateral * (1 - t), ry + lerp(EYE_HEIGHT, 0.45, t), this.z);
    this.camera.rotation.set(lerp(0, -0.9, t), 0, t * Math.PI * 3);
    this.camera.fov = lerp(this.camera.fov, 55, dt * 4);
    this.camera.updateProjectionMatrix();
    return t >= 1;
  }

  update(dt) {
    if (this.dead) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.fovKick = Math.max(0, this.fovKick - dt * 6);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);

    // steering
    let steer = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) steer -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steer += 1;
    steer += this.touchSteer;
    steer = clamp(steer, -1, 1);
    const targetVel = steer * 9;
    this.lateralVel = lerp(this.lateralVel, targetVel, 1 - Math.exp(-dt * 8));
    this.lateral = clamp(this.lateral + this.lateralVel * dt, -(ROAD_HALF - 0.6), ROAD_HALF - 0.6);

    // forward motion
    this.z -= this.speed * dt;
    this.distance += this.speed * dt;

    // punch arm animation
    if (this.punchT >= 0) {
      this.punchT += dt / PUNCH_DURATION;
      if (this.punchT >= 1) {
        this.punchT = -1;
        this.resetArm(this.punchSide);
      } else {
        this.animateArm(this.punchSide, this.punchT);
      }
    }

    // camera follows the road
    const cx = this.road.centerX(this.z);
    const ry = this.road.roadY(this.z);
    const lookZ = this.z - 30;
    const lookX = this.road.centerX(lookZ) + this.lateral * 0.4;
    const lookY = this.road.roadY(lookZ) + 1.1;

    const sh = this.trauma * this.trauma;
    const shx = (Math.random() - 0.5) * 0.22 * sh;
    const shy = (Math.random() - 0.5) * 0.18 * sh + Math.sin(performance.now() * 0.045) * 0.012;
    this.camera.position.set(cx + this.lateral + shx, ry + EYE_HEIGHT + shy, this.z);
    this.camera.lookAt(lookX, lookY, lookZ);
    this.camera.rotation.z += -this.lateralVel * 0.018 + (Math.random() - 0.5) * 0.05 * sh;

    const targetFov = 68 + 6 + this.fovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-dt * 10));
      this.camera.updateProjectionMatrix();
    }

    // invulnerability blink on the arms
    const blink = this.invuln > 0 && Math.floor(performance.now() / 120) % 2 === 0;
    this.cockpit.visible = !blink;
  }

  animateArm(side, t) {
    const arm = this.arms[side];
    if (!arm) return;
    // 0..0.45 extend, 0.45..1 retract
    const ext = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
    const e = ext * ext * (3 - 2 * ext); // smooth
    const fist = arm.fist;
    const rest = arm.pivot.userData.restFist;
    fist.position.set(
      rest.x + side * 0.55 * e,
      rest.y + 0.35 * e,
      rest.z - 0.75 * e
    );
    arm.pivot.rotation.y = side * -0.5 * e;
  }

  resetArm(side) {
    const arm = this.arms[side];
    if (!arm) return;
    arm.fist.position.copy(arm.pivot.userData.restFist);
    arm.pivot.rotation.y = 0;
  }
}
