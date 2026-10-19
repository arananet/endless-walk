// Punch Rider: boot, render loop, game states and scoring.
// First-person motorcycle combat on an endless seeded highway.
// States: menu -> playing <-> paused, playing -> dying -> gameover.

import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { Road, chunkIndexForZ } from './road.js';
import { Rider, RIDER_SPEED, MAX_HEALTH } from './rider.js';
import { Traffic } from './traffic.js';
import { AbsurdPhysics } from './physics.js';
import { SplatManager } from './splats.js';

const HUD_UPDATE_MS = 100;
const COMBO_WINDOW = 3; // seconds between landed punches to keep the combo
const BEST_KEY = 'punchrider_best';

function readSeed() {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw !== null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed)) return parsed >>> 0;
  return (Math.random() * 0xffffffff) >>> 0;
}

function fmtSeed(seed) {
  return seed.toString(16).padStart(8, '0');
}

function makeSky() {
  const geo = new THREE.SphereGeometry(700, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x0d1530) },
      mid: { value: new THREE.Color(0x3a2a52) },
      horizon: { value: new THREE.Color(0xff7a3c) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h))
                          : mix(horizon, mid, smoothstep(-0.05, 0.25, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

async function main() {
  const seed = readSeed();
  const canvas = document.getElementById('scene');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2b1f33, 80, 420);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 900);
  scene.add(camera); // cockpit meshes are parented to the camera

  // dusk vibe lighting
  scene.add(new THREE.HemisphereLight(0x4a5a8a, 0x1a1410, 0.75));
  const sun = new THREE.DirectionalLight(0xff9a5c, 1.3);
  sun.position.set(-60, 35, 80);
  scene.add(sun);
  const sky = makeSky();
  scene.add(sky);

  // rider headlight
  const headlight = new THREE.SpotLight(0xfff2d0, 80, 130, 0.55, 0.45, 1.2);
  headlight.position.set(0, -0.2, -0.4);
  const headTarget = new THREE.Object3D();
  headTarget.position.set(0, -2.5, -40);
  camera.add(headTarget);
  headlight.target = headTarget;
  camera.add(headlight);

  // Spark handles gaussian splat sorting/rendering alongside normal meshes.
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const road = new Road(scene, seed);
  const rider = new Rider(camera, canvas, road);
  const traffic = new Traffic(scene, road, seed);
  const physics = new AbsurdPhysics(scene, road);
  const splats = new SplatManager(scene, road);
  await splats.init();

  // ---- game state ---------------------------------------------------------
  let state = 'menu';
  let score = 0;
  let punches = 0;
  let combo = 0;
  let maxCombo = 0;
  let lastPunchT = -Infinity;
  let hitStopT = 0;
  let slowT = 0;
  let floaterT = 0;
  let gameTime = 0;

  const overlayStart = document.getElementById('overlay-start');
  const overlayPause = document.getElementById('overlay-pause');
  const overlayOver = document.getElementById('overlay-gameover');
  const show = (el, visible) => el.classList.toggle('hidden', !visible);

  function startGame() {
    state = 'playing';
    show(overlayStart, false);
    show(overlayPause, false);
    show(overlayOver, false);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    show(overlayPause, true);
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    show(overlayPause, false);
  }

  function startDying() {
    state = 'dying';
    rider.startWipeout();
  }

  function showGameOver() {
    state = 'gameover';
    const best = Math.max(score | 0, parseInt(localStorage.getItem(BEST_KEY) || '0', 10));
    localStorage.setItem(BEST_KEY, String(best));
    document.getElementById('go-distance').textContent = Math.round(rider.distance).toLocaleString('en-US');
    document.getElementById('go-punches').textContent = punches;
    document.getElementById('go-combo').textContent = 'x' + Math.min(maxCombo, 5);
    document.getElementById('go-score').textContent = Math.round(score).toLocaleString('en-US');
    document.getElementById('go-best').textContent = best.toLocaleString('en-US');
    show(overlayOver, true);
  }

  function restart() {
    rider.reset();
    traffic.reset();
    physics.reset();
    score = 0;
    punches = 0;
    combo = 0;
    maxCombo = 0;
    lastPunchT = -Infinity;
    hitStopT = 0;
    slowT = 0;
    gameTime = 0;
    startGame();
  }

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-resume').addEventListener('click', resumeGame);
  document.getElementById('btn-restart').addEventListener('click', restart);
  document.getElementById('btn-newseed').addEventListener('click', () => {
    const next = (Math.random() * 0xffffffff) >>> 0;
    window.location.search = `?seed=${next}`;
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    }
    if (e.code === 'Enter' && state === 'gameover') restart();
  });

  // physics feedback: hit-stop + shake on every connected punch
  physics.onLaunch = (mag) => {
    hitStopT = 0.09;
    rider.addTrauma(0.45 * mag);
    rider.fovKick = 8;
  };

  // ---- HUD -----------------------------------------------------------------
  document.getElementById('hud-seed').textContent = fmtSeed(seed);
  const elSpeed = document.getElementById('hud-speed');
  const elScore = document.getElementById('hud-score');
  const elCombo = document.getElementById('hud-combo');
  const elHearts = document.getElementById('hud-hearts');
  const elFloater = document.getElementById('hud-floater');
  let lastHud = 0;

  function floater(text) {
    elFloater.textContent = text;
    elFloater.classList.remove('hidden');
    floaterT = 1.1;
  }

  function updateHud(now) {
    if (now - lastHud < HUD_UPDATE_MS) return;
    lastHud = now;
    elSpeed.textContent = Math.round(RIDER_SPEED * 3.6);
    elScore.textContent = Math.round(score).toLocaleString('en-US');
    elCombo.textContent = combo > 1 ? 'x' + Math.min(combo, 5) : '';
    elCombo.classList.toggle('hot', combo >= 3);
    let hearts = '';
    for (let i = 0; i < MAX_HEALTH; i++) hearts += i < rider.health ? '❤' : '🖤';
    elHearts.textContent = hearts;
    if (floaterT > 0) {
      floaterT -= HUD_UPDATE_MS / 1000;
      if (floaterT <= 0) elFloater.classList.add('hidden');
    }
  }

  // ---- combat --------------------------------------------------------------
  function processPunches() {
    for (const side of rider.consumePunches()) {
      const box = rider.hitbox(side);
      const cars = traffic.carsInHitbox(box);
      if (cars.length === 0) continue; // whiff: swing animates, cooldown applies
      const car = cars[0];
      const mesh = traffic.launchCar(car);
      const dzAhead = rider.z - car.z;
      const quality = Math.max(0.2, Math.min(1, 1 - Math.abs(dzAhead - 3) / 5));
      physics.launch(mesh, side, quality);

      punches++;
      const now = gameTime;
      combo = now - lastPunchT < COMBO_WINDOW ? combo + 1 : 1;
      lastPunchT = now;
      maxCombo = Math.max(maxCombo, combo);
      const mult = Math.min(combo, 5);
      score += 150 * mult;
      if (mult > 1) floater(`PUNCH x${mult}`);
    }
  }

  function processTrafficEvents() {
    for (const e of traffic.consumeEvents()) {
      if (e.type === 'hit') {
        slowT = 0.55;
        if (rider.damage() <= 0) {
          startDying();
        } else {
          floater('HIT!');
        }
      } else if (e.type === 'nearmiss') {
        score += 50;
        floater('NEAR MISS +50');
      }
    }
  }

  // ---- resize ---------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- main loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  road.update(0);
  rider.update(0.0001);

  renderer.setAnimationLoop(() => {
    const rawDt = Math.min(clock.getDelta(), 0.05);
    let dt = rawDt;
    if (hitStopT > 0) {
      hitStopT -= rawDt;
      dt = 0;
    } else if (slowT > 0) {
      slowT -= rawDt;
      dt *= 0.35;
    }

    if (state === 'playing') {
      gameTime += dt;
      rider.update(dt);
      const aggression = Math.min(0.12 + (rider.distance / 6000) * 0.3, 0.5);
      road.update(rider.z);
      traffic.update(dt, rider, aggression);
      physics.update(dt);
      splats.update(rider.z);
      processPunches();
      processTrafficEvents();
      score += rider.speed * dt; // 1 pt per meter
      if (gameTime - lastPunchT >= COMBO_WINDOW) combo = 0;
      // keep the sky glued to the rider
      sky.position.set(rider.x, 0, rider.z);
      sun.position.set(rider.x - 60, 35, rider.z + 80);
      updateHud(performance.now());
    } else if (state === 'dying') {
      if (rider.updateWipeout(rawDt)) showGameOver();
      physics.update(rawDt);
    } else if (state === 'menu') {
      // idle backdrop: slow drift forward
      sky.position.set(rider.x, 0, rider.z);
    }

    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error('[punch-rider] fatal boot error:', err);
  const p = document.querySelector('#overlay-start .card p');
  if (p) p.textContent = 'Something went wrong while starting the ride. Please reload the page.';
});
