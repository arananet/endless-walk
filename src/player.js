// First-person player controller.
// Desktop: WASD/arrows to walk, mouse drag or pointer lock to look.
// Mobile: left virtual joystick to walk, drag on the right side to look.
// The player is ground-clamped to the analytic terrain height and softly
// pushed back toward the trail when wandering too far sideways.

import * as THREE from 'three';
import { clamp } from './rng.js';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.4;
const SOFT_LIMIT = 10; // meters from path center before pushback starts
const HARD_LIMIT = 22; // absolute lateral clamp

export class Player {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.camera.rotation.order = 'YXZ';

    this.yaw = 0;
    this.pitch = -0.04;
    this.startZ = 6;
    this.pos = new THREE.Vector3(0, 0, this.startZ);

    this.keys = {};
    this.autoWalk = false;
    this.distance = 0;
    this.bobPhase = 0;
    this.moving = false;

    this.dragging = false;
    this.lastPX = 0;
    this.lastPY = 0;

    // Touch state.
    this.isTouch = 'ontouchstart' in window;
    if (this.isTouch) document.body.classList.add('touch');
    this.joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
    this.lookTouch = { id: null, x: 0, y: 0 };

    this.onFirstInteract = null; // set by main.js to dismiss the start overlay
    this._interacted = false;

    this.bindDesktop();
    this.bindTouch();
  }

  interact() {
    if (!this._interacted) {
      this._interacted = true;
      if (this.onFirstInteract) this.onFirstInteract();
    }
  }

  bindDesktop() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyT') this.toggleAutoWalk();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.interact();
      if (document.pointerLockElement !== this.canvas) {
        // Drag-to-look fallback; click (no drag) requests pointer lock.
        this.dragging = true;
        this.lastPX = e.clientX;
        this.lastPY = e.clientY;
        this._downX = e.clientX;
        this._downY = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.dragging) {
        const moved = Math.hypot(e.clientX - this._downX, e.clientY - this._downY);
        this.dragging = false;
        if (moved < 6 && !this.isTouch) {
          this.canvas.requestPointerLock?.();
        }
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.yaw -= e.movementX * 0.0022;
        this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.35, 1.35);
      } else if (this.dragging) {
        this.yaw -= (e.clientX - this.lastPX) * 0.004;
        this.pitch = clamp(this.pitch - (e.clientY - this.lastPY) * 0.004, -1.35, 1.35);
        this.lastPX = e.clientX;
        this.lastPY = e.clientY;
      }
    });
  }

  bindTouch() {
    const joyEl = document.getElementById('joystick');
    const stickEl = document.getElementById('stick');
    const R = 44;

    const setStick = (dx, dy) => {
      stickEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };

    window.addEventListener('touchstart', (e) => {
      this.interact();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && this.joy.id === null) {
          this.joy.id = t.identifier;
          this.joy.active = true;
          this.joy.cx = t.clientX;
          this.joy.cy = t.clientY;
          this.joy.dx = 0;
          this.joy.dy = 0;
          joyEl.style.left = `${t.clientX - 60}px`;
          joyEl.style.top = `${t.clientY - 60}px`;
          joyEl.style.bottom = 'auto';
        } else if (this.lookTouch.id === null) {
          this.lookTouch.id = t.identifier;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          let dx = t.clientX - this.joy.cx;
          let dy = t.clientY - this.joy.cy;
          const len = Math.hypot(dx, dy);
          if (len > R) {
            dx = (dx / len) * R;
            dy = (dy / len) * R;
          }
          this.joy.dx = dx / R;
          this.joy.dy = dy / R;
          setStick(dx, dy);
        } else if (t.identifier === this.lookTouch.id) {
          this.yaw -= (t.clientX - this.lookTouch.x) * 0.005;
          this.pitch = clamp(this.pitch - (t.clientY - this.lookTouch.y) * 0.005, -1.35, 1.35);
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: true });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null;
          this.joy.active = false;
          this.joy.dx = 0;
          this.joy.dy = 0;
          setStick(0, 0);
          joyEl.style.left = '22px';
          joyEl.style.top = 'auto';
          joyEl.style.bottom = '26px';
        }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = null;
      }
    };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);
  }

  toggleAutoWalk() {
    this.autoWalk = !this.autoWalk;
    const btn = document.getElementById('btn-autowalk');
    if (btn) {
      btn.textContent = `Auto-walk: ${this.autoWalk ? 'on' : 'off'}`;
      btn.classList.toggle('active', this.autoWalk);
    }
  }

  update(dt, world) {
    let ix = 0;
    let iz = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) iz += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) iz -= 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) ix -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) ix += 1;
    if (this.autoWalk) iz += 1;
    if (this.joy.active) {
      ix += this.joy.dx;
      iz += -this.joy.dy; // stick up means forward
    }
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    this.moving = len > 0.05;

    // Camera-relative move on the XZ plane. Yaw 0 faces -Z.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const vx = (ix * cos - iz * sin) * WALK_SPEED;
    const vz = (-ix * sin - iz * cos) * WALK_SPEED;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // Soft pushback toward the path, then a hard lateral clamp.
    const px = world.pathX(this.pos.z);
    let dx = this.pos.x - px;
    if (Math.abs(dx) > SOFT_LIMIT) {
      const push = (Math.abs(dx) - SOFT_LIMIT) * 2.5;
      this.pos.x -= Math.sign(dx) * push * dt;
    }
    dx = this.pos.x - px;
    if (Math.abs(dx) > HARD_LIMIT) this.pos.x = px + Math.sign(dx) * HARD_LIMIT;

    // Ground clamp with a subtle head bob while moving.
    let y = world.heightAt(this.pos.x, this.pos.z) + EYE_HEIGHT;
    if (this.moving) {
      this.bobPhase += dt * 9;
      y += Math.sin(this.bobPhase) * 0.045;
    }
    this.pos.y = y;

    this.camera.position.copy(this.pos);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this.distance = Math.max(0, this.startZ - this.pos.z);
  }
}
