// Endless Walk: boot, render loop and HUD wiring.

import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { World, chunkIndexForZ } from './world.js';
import { Player } from './player.js';
import { SplatManager } from './splats.js';

const HUD_UPDATE_MS = 120;

function readSeed() {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw !== null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed)) return parsed >>> 0;
  return (Math.random() * 0xffffffff) >>> 0;
}

function fmtSeed(seed) {
  return seed.toString(16).padStart(8, '0');
}

async function main() {
  const seed = readSeed();
  const canvas = document.getElementById('scene');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 800);

  // Spark handles gaussian splat sorting/rendering alongside normal meshes.
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const world = new World(scene, seed);
  const player = new Player(camera, canvas);
  const splats = new SplatManager(scene, world);
  await splats.init();

  // ---- game state: menu -> playing <-> paused ---------------------------
  let state = 'menu';
  const overlayStart = document.getElementById('overlay-start');
  const overlayPause = document.getElementById('overlay-pause');

  const show = (el, visible) => el.classList.toggle('hidden', !visible);

  function startGame() {
    state = 'playing';
    show(overlayStart, false);
    show(overlayPause, false);
    if (!player.isTouch) canvas.requestPointerLock?.();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    show(overlayPause, true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    show(overlayPause, false);
    if (!player.isTouch) canvas.requestPointerLock?.();
  }

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-resume').addEventListener('click', resumeGame);
  document.getElementById('btn-newseed').addEventListener('click', () => {
    const next = (Math.random() * 0xffffffff) >>> 0;
    window.location.search = `?seed=${next}`;
  });
  document.getElementById('btn-autowalk').addEventListener('click', () => player.toggleAutoWalk());

  player.onFirstInteract = () => {
    if (state === 'menu') startGame();
  };

  document.addEventListener('pointerlockchange', () => {
    // Esc during pointer lock drops back to the pause screen.
    if (!document.pointerLockElement && state === 'playing' && !player.isTouch) pauseGame();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    }
  });

  // ---- HUD ---------------------------------------------------------------
  document.getElementById('hud-seed').textContent = fmtSeed(seed);
  const elDistance = document.getElementById('hud-distance');
  const elBiome = document.getElementById('hud-biome');
  let lastHud = 0;
  function updateHud(now) {
    if (now - lastHud < HUD_UPDATE_MS) return;
    lastHud = now;
    elDistance.textContent = Math.round(player.distance).toLocaleString('en-US');
    elBiome.textContent = world.biomeAtZ(player.pos.z).name;
  }

  // ---- resize -------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- main loop -----------------------------------------------------------
  const clock = new THREE.Clock();
  // Prime the world so the first frame already shows terrain.
  world.update(player.pos.z, 0.016, player.pos);
  player.update(0.0001, world);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (state === 'playing' || state === 'menu') {
      player.update(dt, world);
      world.update(player.pos.z, dt, player.pos);
      splats.update(chunkIndexForZ(player.pos.z));
      updateHud(performance.now());
    }
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error('[endless-walk] fatal boot error:', err);
  document.querySelector('#overlay-start .card p').textContent =
    'Something went wrong while starting the walk. Please reload the page.';
});
