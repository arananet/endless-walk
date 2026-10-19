#!/bin/sh
# Test gate for endless-walk / Punch Rider (see .openspec/config.yaml).
# No build step in this project: syntax-check every module, validate JSON,
# assert the seeded RNG is deterministic, verify the road module exposes the
# API the splat manager depends on, and forbid em dashes in shipped text.
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

echo "== road/splat contract =="
node -e "
const fs = require('fs');
const src = fs.readFileSync('src/road.js', 'utf8');
for (const name of ['chunkIndexForZ', 'chunkCenterZ', 'class Road']) {
  if (!src.includes(name)) { console.error('FAIL: road.js missing ' + name); process.exit(1); }
}
for (const m of ['pathX(', 'heightAt(', 'laneCenterX(', 'setSceneryOverride(', 'corridorBounds(']) {
  if (!src.includes(m)) { console.error('FAIL: Road missing method ' + m); process.exit(1); }
}
console.log('ok: road exports the splat-manager contract');
"

echo "== no em dashes =="
python3 - <<'EOF'
import sys, pathlib
roots = ['src', 'index.html', 'public', 'README.md', 'CHANGELOG.md', 'scripts',
         '.openspec/specs/moto-road-generation.spec.yaml',
         '.openspec/specs/moto-punch-combat.spec.yaml',
         '.openspec/specs/absurd-physics-engine.spec.yaml',
         '.openspec/specs/splat-landmarks.spec.yaml',
         '.openspec/specs/cloudflare-pages-deployment.spec.yaml',
         '.openspec/config.yaml']
exts = {'.js', '.html', '.json', '.yaml', '.md', '.sh'}
bad = []
for r in roots:
    p = pathlib.Path(r)
    files = [p] if p.is_file() else [f for f in p.rglob('*') if f.is_file() and f.suffix in exts]
    for f in files:
        try:
            text = f.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        if '\u2014' in text:
            bad.append(str(f))
if bad:
    print('FAIL: em dash found in:')
    for b in bad:
        print('  ' + b)
    sys.exit(1)
print('ok: no em dashes')
EOF

echo "ALL CHECKS PASSED"
