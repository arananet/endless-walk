# endless-walk

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) ![Three.js](https://img.shields.io/badge/Three.js-gray) ![Spark.js](https://img.shields.io/badge/Spark.js-gray) ![Gaussian Splatting](https://img.shields.io/badge/Gaussian_Splatting-gray) ![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-gray) ![OpenSpec](https://img.shields.io/badge/OpenSpec-enforced-blueviolet) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

> Endless first-person walking game: procedurally generated infinite routes with gaussian splat landmarks, running fully client-side.

---

## Quick start

There is no build step. Clone, serve the folder with any static server, and open it in a browser.

```bash
git clone https://github.com/arananet/endless-walk.git
cd endless-walk
python3 -m http.server 8080
# open http://localhost:8080
```

Append `?seed=12345` to replay a specific walk, or press "New walk" for a random seed.

---

## Usage

* WASD or arrow keys: walk. T or the Auto-walk button: toggle automatic walking.
* Mouse: click the scene to capture the cursor, move to look. Drag also works without pointer lock.
* P or Esc: pause and resume.
* Mobile: left virtual joystick to walk, drag the right side of the screen to look.

The trail gently pushes you back if you wander too far sideways, and the HUD shows distance walked, the current biome, and the seed.

---

## How it works

The game combines two different techniques, each doing what it is good at:

* **Procedural infinite route (client side).** The world is a sequence of 60 meter chunks along the forward axis. Each chunk is generated deterministically from `(seed, chunkIndex)`: a displaced terrain heightfield, a curving walkable path ribbon smoothed across chunk borders with Catmull-Rom interpolation, instanced trees and rocks kept clear of the trail, and a biome (forest, meadow, desert, canyon, snowfield) picked from a seeded schedule. Chunks ahead are generated on demand, chunks behind are disposed. The terrain height is an analytic function, so the player ground clamp and the landmark placer query it without mesh sampling.
* **Baked splat landmarks.** Gaussian splats render real captured places, but a splat is a baked capture: it cannot be generated on the fly. So splats are not used for the infinite terrain. They are used for what they are best at: a small set of photoreal landmark scenes pinned to specific chunks, rendered with Spark.js alongside the procedural geometry.

Why this split: splats are baked captures, procedural generation gives infinity. The procedural side runs entirely on the client with zero GPU server cost, which is exactly why static hosting on Cloudflare Pages fits: there is no backend to pay for.

---

## Capture pipeline for landmarks

To add a real landmark:

1. Capture the place with your phone (walk around it, 100 to 300 photos with good overlap).
2. Train the 3D gaussian splat. Either use a cloud service like Polycam or Luma, or train locally with open 3DGS tooling on an RTX 3090.
3. Export as `.spz` (small, streams well). `.ply` also works.
4. Drop the file into `public/splats/` (for example `public/splats/landmarks/ruined-arch.spz`).
5. Register it in `public/splats/manifest.json` with the target chunk index and a lateral offset from the path:

```json
{
  "id": "ruined-arch",
  "file": "splats/landmarks/ruined-arch.spz",
  "chunkIndex": 3,
  "offset": { "x": 8, "y": 0, "z": 0 }
}
```

Entries that point at files which do not exist yet render as glowing placeholder obelisks and log a warning instead of crashing, so the game always stays playable while captures are in progress.

---

## Deploy on Cloudflare Pages

Option A, drag and drop: open Cloudflare Pages, create a project, drag this folder in. Leave the build command empty and set the output directory to `/`.

Option B, git: this repo is already on GitHub. Connect it in Cloudflare Pages with framework preset "None", build command empty, output directory `/`. Every push redeploys.

No environment variables or secrets are needed. All dependencies load from CDN via the import map in `index.html` (three@0.186.1, @sparkjsdev/spark@2.3.1).

---

## Project structure

```
index.html                  import map (CDN pins), HUD, overlays, CSS
src/main.js                 boot, render loop, game state, HUD wiring
src/rng.js                  seeded PRNG (mulberry32), integer hashing, helpers
src/biomes.js               biome palettes, atmosphere, vegetation density, schedule
src/world.js                chunk system, analytic terrain, path ribbon, flora
src/player.js               first-person controls (desktop + touch), ground clamp
src/splats.js               Spark.js landmark loading with placeholder fallback
public/splats/manifest.json landmark registry (placeholder entries included)
scripts/test.sh             test gate: node --check, JSON validation, RNG determinism
.openspec/                  OpenSpec config, feature specs and spec templates
```

---

## Roadmap

* Real baked landmarks replacing the two placeholder entries, captured on location.
* World Labs Marble splat export as a future landmark source, once its export format stabilizes.
* Denser trail life: ambient audio tied to biomes, distant landmark silhouettes.
* Multiplayer: shared seeds with visible walkers, later.

---

## Contributing

This project uses **OpenSpec** for spec-driven development. Every feature or bugfix starts with a spec file under `.openspec/specs/`, following the templates in `.openspec/templates/`. Each spec includes a `roles` block to assign responsibility (`implementer`, `reviewer`, `qa`, `product_owner`) and needs `title`, `description`, `acceptance_criteria`, `test_plan` and `status`.

The test gate is `sh scripts/test.sh`: it syntax-checks every module, validates the JSON files, and asserts the seeded RNG is deterministic. Run it before every commit.

---

## Documentation

| Topic | Where |
| --- | --- |
| Feature specs | [`.openspec/specs/`](.openspec/specs/) |
| Spec-driven workflow config | [`.openspec/config.yaml`](.openspec/config.yaml) |
| Splat capture pipeline | [README](#capture-pipeline-for-landmarks) |
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
