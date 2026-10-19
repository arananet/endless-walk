#!/bin/sh
# Minimal test gate for endless-walk (see .openspec/config.yaml).
# No build step in this project: syntax-check every module, validate JSON,
# and assert the seeded RNG is deterministic.
set -e
cd "$(dirname "$0")/.."

echo "== node --check =="
for f in src/*.js; do
  node --check "$f" && echo "ok: $f"
done

echo "== JSON validation =="
python3 -c "import json; json.load(open('public/splats/manifest.json')); print('ok: manifest.json')"
python3 -c "import json; json.load(open('package.json')); print('ok: package.json')"

echo "== determinism =="
node --input-type=module -e "
import { mulberry32, hashInts } from './src/rng.js';
const a = mulberry32(12345), b = mulberry32(12345);
const s1 = Array.from({ length: 200 }, () => a());
const s2 = Array.from({ length: 200 }, () => b());
if (JSON.stringify(s1) !== JSON.stringify(s2)) { console.error('FAIL: mulberry32 not deterministic'); process.exit(1); }
if (hashInts(7, 42, 99) !== hashInts(7, 42, 99)) { console.error('FAIL: hashInts not deterministic'); process.exit(1); }
if (hashInts(7, 42, 99) === hashInts(7, 42, 100)) { console.error('FAIL: hashInts ignores input'); process.exit(1); }
console.log('ok: rng deterministic');
"

echo "ALL CHECKS PASSED"
