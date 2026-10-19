// Traffic: ambient and aggressive cars on the endless highway.
// Cars spawn ahead, cruise in their lane, and some telegraph (>= 0.8 s of
// visible lean and lane drift) before swerving at the rider. Punch hits,
// near misses and rider collisions are reported as events for main.js.
// The aggression level is a plain input so the future AI director spec can
// drive it later without changing this module.

import * as THREE from 'three';
import { mulberry32, hashInts, range, pick, clamp } from './rng.js';
import { LANES, ROAD_HALF, LANE_WIDTH } from './road.js';

const MAX_CARS = 14;
const TELEGRAPH_TIME = 0.9;
const ATTACK_SPEED = 6.5;
const COLLIDE_DZ = 2.6;
const COLLIDE_LAT = 1.3;
const NEAR_MISS_MIN = 1.3;
const NEAR_MISS_MAX = 2.8;

const CAR_COLORS = [0xc0392b, 0x2980b9, 0x7f8c8d, 0x2c3e50, 0xf39c12, 0x8e44ad, 0x16a085, 0xdfe3e6];

export class Traffic {
  constructor(scene, road, seed) {
    this.scene = scene;
    this.road = road;
    this.rng = mulberry32(hashInts(seed, 0x7AF1C));
    this.cars = [];
    this.events = [];
    this.spawnT = 0;
    this.time = 0;
  }

  buildCarMesh() {
    const color = pick(this.rng, CAR_COLORS);
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e141c, roughness: 0.15, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.3), bodyMat);
    body.position.y = 0.66;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.55, 2.1), glassMat);
    cabin.position.set(0, 1.2, 0.25);
    g.add(cabin);
    const wheelG = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10);
    wheelG.rotateZ(Math.PI / 2);
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.9 });
    for (const [wx, wz] of [[-0.85, -1.4], [0.85, -1.4], [-0.85, 1.4], [0.85, 1.4]]) {
      const w = new THREE.Mesh(wheelG, wheelM);
      w.position.set(wx, 0.34, wz);
      g.add(w);
    }
    const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 3 });
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lightM);
      h.position.set(s * 0.6, 0.72, -2.16);
      g.add(h);
    }
    const tailM = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 2.2 });
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), tailM);
      t.position.set(s * 0.6, 0.78, 2.16);
      g.add(t);
    }
    return g;
  }

  spawnCar(riderZ, riderX, aggression) {
    if (this.cars.length >= MAX_CARS) return;
    const lane = Math.floor(this.rng() * LANES);
    const z = riderZ - range(this.rng, 150, 250);
    // keep a gap from cars already in this lane
    for (const c of this.cars) {
      if (c.lane === lane && Math.abs(c.z - z) < 30) return;
    }
    const mesh = this.buildCarMesh();
    const speed = range(this.rng, 20, 30);
    const aggressive = this.rng() < aggression;
    const car = {
      mesh, lane, z, speed,
      x: this.road.laneCenterX(lane, z) + range(this.rng, -0.4, 0.4),
      state: aggressive ? 'hunter' : 'cruise',
      telegraphT: 0, attackT: 0, attackDir: 0,
      minLat: Infinity, hitDone: false, launched: false,
      wobblePhase: this.rng() * Math.PI * 2,
      lean: 0,
    };
    this.cars.push(car);
    this.scene.add(mesh);
  }

  update(dt, rider, aggression) {
    this.time += dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnCar(rider.z, rider.x, aggression);
      this.spawnT = range(this.rng, 0.7, 1.4);
    }

    const riderX = rider.x;
    const riderZ = rider.z;

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const dz = riderZ - car.z; // > 0 while the car is ahead

      // cull behind / too far ahead
      if (dz < -40 || dz > 420) {
        this.removeCar(i);
        continue;
      }

      // forward motion (same direction as the rider, slower)
      car.z -= car.speed * dt;

      // behavior
      if (car.state === 'hunter' && dz < 110 && dz > 0) {
        car.state = 'telegraph';
        car.telegraphT = TELEGRAPH_TIME;
      }
      if (car.state === 'telegraph') {
        car.telegraphT -= dt;
        const dir = Math.sign(riderX - car.x) || 1;
        car.attackDir = dir;
        // visible lean and lane drift toward the rider
        car.lean = lerpLean(car.lean, dir * 0.14, dt);
        car.x += dir * 1.4 * dt;
        if (car.telegraphT <= 0) {
          car.state = 'attack';
          car.attackT = 2.2;
        }
      } else if (car.state === 'attack') {
        car.attackT -= dt;
        car.x += car.attackDir * ATTACK_SPEED * dt;
        car.lean = lerpLean(car.lean, car.attackDir * 0.2, dt);
        if (car.attackT <= 0 || dz < 2) {
          car.state = 'cruise';
          car.lean = 0;
        }
      } else if (car.state === 'cruise') {
        car.x += Math.sin(this.time * 0.9 + car.wobblePhase) * 0.25 * dt;
        car.lean = lerpLean(car.lean, 0, dt);
      } else if (car.state === 'crashed') {
        car.speed = Math.max(0, car.speed - 30 * dt);
        car.mesh.rotation.y += dt * 2;
      }

      // keep on the road
      const cx = this.road.centerX(car.z);
      car.x = clamp(car.x, cx - ROAD_HALF + 0.9, cx + ROAD_HALF - 0.9);

      // near-miss tracking
      const lat = Math.abs(car.x - riderX);
      if (Math.abs(dz) < 10) car.minLat = Math.min(car.minLat, lat);

      // collision with the rider
      if (!car.hitDone && Math.abs(dz) < COLLIDE_DZ && lat < COLLIDE_LAT && rider.invuln <= 0 && !rider.dead) {
        car.hitDone = true;
        car.state = 'crashed';
        this.events.push({ type: 'hit', car });
      }

      // passed the rider: resolve near miss
      if (!car.hitDone && !car.counted && dz < -3) {
        car.counted = true;
        if (car.minLat >= NEAR_MISS_MIN && car.minLat < NEAR_MISS_MAX) {
          this.events.push({ type: 'nearmiss', car });
        }
      }

      // place the mesh
      car.mesh.position.set(car.x, this.road.roadY(car.z) + 0.02, car.z);
      car.mesh.rotation.z = -car.lean;
      // face travel direction with a slight steer into lateral motion
      car.mesh.rotation.y = clamp((car.x - (car.prevX ?? car.x)) * 2, -0.3, 0.3);
      car.prevX = car.x;
    }
  }

  // Cars inside a punch hitbox, closest first. Hitbox: {x0, x1, zNear, zFar}.
  carsInHitbox(box) {
    const out = [];
    for (const car of this.cars) {
      if (car.launched || car.state === 'crashed') continue;
      if (car.z <= box.zNear && car.z >= box.zFar && car.x >= box.x0 && car.x <= box.x1) {
        out.push(car);
      }
    }
    out.sort((a, b) => Math.abs(a.z) - Math.abs(b.z));
    return out;
  }

  // Hand a car to the physics engine: detach from traffic, keep the mesh.
  launchCar(car) {
    car.launched = true;
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    return car.mesh;
  }

  removeCar(i) {
    const car = this.cars[i];
    this.cars.splice(i, 1);
    this.scene.remove(car.mesh);
    car.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  reset() {
    for (let i = this.cars.length - 1; i >= 0; i--) this.removeCar(i);
    this.events = [];
    this.spawnT = 0;
  }
}

function lerpLean(v, target, dt) {
  return v + (target - v) * (1 - Math.exp(-dt * 6));
}
