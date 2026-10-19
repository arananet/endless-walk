# Punch Rider

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) ![Three.js](https://img.shields.io/badge/Three.js-gray) ![Spark.js](https://img.shields.io/badge/Spark.js-gray) ![Gaussian Splatting](https://img.shields.io/badge/Gaussian_Splatting-gray) ![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-gray) ![OpenSpec](https://img.shields.io/badge/OpenSpec-enforced-blueviolet) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

> First-person motorcycle combat on an endless seeded highway. Traffic swerves at you. Punch it first.

---

## Quick start

There is no build step. Clone, serve the folder with any static server, and open it in a browser.

```bash
git clone https://github.com/arananet/endless-walk.git
cd endless-walk
python3 -m http.server 8080
# open http://localhost:8080
```

Append `?seed=12345` to replay a specific highway, or press "New run" for a random seed.

---

## Usage

* A/D or arrow keys: steer between lanes at 140 km/h.
* Q/E, or click the left/right half of the screen: punch left/right. A connected punch launches the car with the absurd physics engine.
* P or Esc: pause. Enter on the game over screen: ride again.
* Mobile: drag to steer, tap the left/right half to punch.

3 hits and you wipe out. Near misses pay +50. Landed punches chain a combo multiplier up to x5 within a 3 second window. Best score is kept in localStorage.

---

## How it works

The game is three systems on top of a seeded road:

* **Seeded endless road.** The highway is a sequence of 60 meter chunks along the forward axis, deterministic from `(seed, chunkIndex)`: a 3 lane ribbon with gentle curves and elevation, lane markings, guardrails, streetlights, and roadside terrain with vegetation. Chunks generate ahead and dispose behind. Road height is an analytic function shared by the mesh, the rider, traffic and splat placement, so nothing ever samples the mesh.
* **Punch combat.** Traffic spawns ahead with ambient cruisers and aggressive drivers. Aggressors telegraph for at least 0.8 seconds with a visible lean and lane drift before swerving at the rider. Punches have a 0.35 s cooldown and a hitbox of 2.5 m on the punching side; a whiff still swings.
* **Absurd physics engine.** A bespoke lightweight layer tuned for comedy instead of realism. Punched cars launch with upward and lateral velocity plus angular velocity, bounce with squash at least once, and shed pooled debris. Every connect triggers a 90 ms hit-stop and a screen shake scaled to the launch.

**Splat corridors.** Roadside scenery is grouped per chunk as a replaceable corridor, so a future baked gaussian splat capture can take over the procedural scenery at the same alignment without touching the road or the gameplay. The two planned systems plug in here: the splat world platform (any real street becomes a level) and the agentic AI director (it will drive the `aggression` input that traffic already accepts). Neither is implemented yet; the seams are.

**Why this split.** Photorealism in a real-time browser game comes from baked captures, not from procedural generation. The road and the action are procedural and infinite; the photoreal layer arrives as baked splat corridors. Everything runs client-side with zero GPU server cost, which is exactly why static hosting on Cloudflare Pages fits.

---

## Capture pipeline for splat corridors

To add a real roadside capture later:

1. Capture the street with your phone (100 to 300 photos with good overlap).
2. Train the 3D gaussian splat with Polycam, Luma, or local 3DGS tooling on an RTX 3090.
3. Export as `.spz` and register it in `public/splats/manifest.json` with the target chunk index and offset.

Entries that point at files which do not exist yet render as glowing placeholder obelisks and log a warning instead of crashing.

---

## Deploy on Cloudflare Pages

Push this repo to GitHub, connect it in Cloudflare Pages with framework preset "None", build command empty, output directory `/`. Every push redeploys. No environment variables or secrets are needed. All dependencies load from CDN via the import map in `index.html` (three@0.186.1, @sparkjsdev/spark@2.3.1).

---

## Project structure

```
index.html                  import map (CDN pins), HUD, overlays, CSS
src/main.js                 boot, render loop, game states, scoring, hit-stop
src/rng.js                  seeded PRNG (mulberry32), integer hashing, helpers
src/road.js                 seeded highway chunks, analytic road height, splat corridor seam
src/rider.js                first-person moto controller, cockpit, punch animation
src/traffic.js              car spawning, cruise and aggressive behaviors, collisions
src/physics.js              absurd physics engine: tumbling cars, pooled debris
src/splats.js               Spark.js landmark loading with placeholder fallback
public/splats/manifest.json landmark registry (placeholder entries included)
scripts/test.sh             test gate: node --check, JSON validation, determinism, no em dashes
.openspec/                  OpenSpec config, feature specs and spec templates
```

---

## Roadmap

* Splat corridor captures replacing procedural roadside (splat world platform spec, draft).
* Agentic AI director driving traffic aggression and set-pieces (ai-director spec, draft).
* Real baked landmarks on the current manifest entries.
* Ambient audio tied to speed and impacts.

---

## Contributing

This project uses **OpenSpec** for spec-driven development. Every feature or bugfix starts with a spec file under `.openspec/specs/`, following the templates in `.openspec/templates/`. Each spec includes a `roles` block to assign responsibility (`implementer`, `reviewer`, `qa`, `product_owner`) and needs `title`, `description`, `acceptance_criteria`, `test_plan` and `status`.

The test gate is `sh scripts/test.sh`: it syntax-checks every module, validates the JSON files, asserts the seeded RNG is deterministic, verifies the road module exposes the API the splat manager depends on, and rejects em dashes. Run it before every commit.

---

## Documentation

| Topic | Where |
| --- | --- |
| Feature specs | [`.openspec/specs/`](.openspec/specs/) |
| Spec-driven workflow config | [`.openspec/config.yaml`](.openspec/config.yaml) |
| Splat capture pipeline | [README](#capture-pipeline-for-splat-corridors) |
| Cloudflare Pages deploy | [README](#deploy-on-cloudflare-pages) |
| Release history | [`CHANGELOG.md`](CHANGELOG.md) |

---

## License

[MIT](LICENSE)

---

## Developer

Eduardo Arana

## Support this with a ko-fi

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H51MPWG)
