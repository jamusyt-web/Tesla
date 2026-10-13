import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { current as currentMap } from '../map.js';
import { setWorld, upgradeMap } from '../../shared/world.js';
import { BUDGET, estimateChunk } from '../../shared/budget.js';

// The budget estimator (the world editor's meter) against what the perf
// census measured in the game, chunk by chunk, on today's map and on the
// five-town stress map. (npm run perf:census -- --map real|stress refreshes
// the measurements; copy last-*.json's chunks into baseline-*.json.)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
after(() => setWorld(currentMap.map));

const total = (c) => ({ draws: c.scenery.draws + c.scenery.tileDraws + c.statics.draws, tris: c.scenery.tris + c.scenery.tileTris + c.statics.tris });

for (const [name, mapFile] of [['real', 'maps/world.json'], ['stress', 'maps/fixtures/stress.json']]) {
  test(`the estimate is within 15% of the census (${name} map)`, () => {
    setWorld(upgradeMap(read(mapFile)));
    const base = read(`scripts/perf/baseline-${name}.json`);
    assert.ok(base.chunks.length > 5);
    let [md, ed, mt, et] = [0, 0, 0, 0];
    for (const c of base.chunks) {
      const [i, j] = c.key.split(',').map(Number);
      const m = total(c);
      const e = total(estimateChunk(i, j, { level: c.level }));
      md += m.draws;
      ed += e.draws;
      mt += m.tris;
      et += e.tris;
      // Each chunk roughly (a few draws or triangles either way on small ones)…
      assert.ok(Math.abs(e.draws - m.draws) <= Math.max(3, m.draws * 0.25), `${name} ${c.key} draws: estimated ${e.draws}, measured ${m.draws}`);
      assert.ok(Math.abs(e.tris - m.tris) <= Math.max(7000, m.tris * 0.25), `${name} ${c.key} triangles: estimated ${e.tris}, measured ${m.tris}`);
    }
    // …and the map as a whole within 15%.
    assert.ok(Math.abs(ed - md) <= md * 0.15, `${name} draws: estimated ${ed}, measured ${md}`);
    assert.ok(Math.abs(et - mt) <= mt * 0.15, `${name} triangles: estimated ${et}, measured ${mt}`);
  });
}

test('the stress map is valid and as big as the plan says', () => {
  const m = upgradeMap(read('maps/fixtures/stress.json'));
  setWorld(m);
  assert.equal(m.lands.length, 79);
  assert.equal(m.stones.length, 12);
  assert.equal(m.buildings.length, 45);
  assert.ok(m.props.filter((p) => p.r > 0).length > 3000, 'about 3,500 blocking props');
  assert.ok(m.nodes.length >= 400 && m.spawns.length === 60);
  assert.ok(fs.statSync(path.join(ROOT, 'maps/fixtures/stress.json')).size < 1_000_000);
  assert.ok(BUDGET.draws === 250 && BUDGET.programs === 40);
});
