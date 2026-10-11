import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { current as currentMap } from '../map.js';
import { setWorld, buildColliders, indexColliders, isWalkable, landDistance, NavGrid, EXTENT, WORLD_RADIUS, mulberry32 } from '../../shared/world.js';

// These tests swap in made-up worlds; put the real one back afterwards.
after(() => setWorld(currentMap.map));

const base = () => ({ format: 2, name: 'Test', rev: 1, spawn: { x: 0, z: 0 }, lands: [] });

test('several pieces of land: walk on any of them, across where they overlap, never at sea', () => {
  setWorld({ ...base(), lands: [{ id: 'a', x: 0, z: 0, r: 60 }, { id: 'bridge', x: 75, z: 0, r: 20 }, { id: 'b', x: 160, z: 0, r: 70 }, { id: 'far', x: 0, z: 400, r: 30 }] });
  const col = buildColliders();
  assert.ok(isWalkable(0, 0, col) && isWalkable(75, 0, col) && isWalkable(160, 0, col) && isWalkable(0, 400, col));
  assert.ok(!isWalkable(0, 200, col), 'open sea');
  assert.ok(landDistance(0, 0) < 0 && landDistance(0, 200) > 0);
  assert.equal(EXTENT.x1, 232);
  assert.equal(EXTENT.z1, 432);
  assert.ok(WORLD_RADIUS >= 430);
  const nav = new NavGrid(col);
  const p = nav.findPath(-40, 0, 200, 10);
  assert.ok(p, 'walks over the land bridge to the next island');
  assert.ok(!nav.findPath(0, 0, 0, 400), 'no walking to an island across the sea');
});

test('the collider index gives the same answers as checking everything', () => {
  setWorld({ ...base(), lands: [{ id: 'a', x: 0, z: 0, r: 120 }] });
  const rng = mulberry32(5);
  const rects = [];
  const circles = [];
  for (let i = 0; i < 300; i++) circles.push({ x: (rng() - 0.5) * 220, z: (rng() - 0.5) * 220, r: 0.2 + rng() * 3 });
  for (let i = 0; i < 40; i++) rects.push({ x: (rng() - 0.5) * 220, z: (rng() - 0.5) * 220, w: 1 + rng() * 12, d: 1 + rng() * 12 });
  const indexed = indexColliders({ rects, circles });
  const plain = { rects, circles };
  for (let i = 0; i < 20000; i++) {
    const x = (rng() - 0.5) * 240;
    const z = (rng() - 0.5) * 240;
    assert.equal(isWalkable(x, z, indexed), isWalkable(x, z, plain), `at ${x}, ${z}`);
  }
});

test('a 2 km world with thousands of things stays quick to path across', () => {
  const props = [];
  const rng = mulberry32(9);
  for (let i = 0; i < 6000; i++) props.push({ id: `p${i}`, slot: 'prop_barrel', x: (rng() - 0.5) * 1900, z: (rng() - 0.5) * 1900, rot: 0, r: 0.6 });
  setWorld({ ...base(), lands: [{ id: 'big', x: 0, z: 0, r: 1000 }], props });
  const t0 = performance.now();
  const col = buildColliders();
  const nav = new NavGrid(col);
  const t1 = performance.now();
  const p = nav.findPath(-300, -300, 250, 280);
  const t2 = performance.now();
  assert.ok(p && p.length, 'found a long path');
  assert.ok(t1 - t0 < 300, `setup took ${(t1 - t0).toFixed(0)} ms`);
  assert.ok(t2 - t1 < 1500, `a ~800 m path took ${(t2 - t1).toFixed(0)} ms`);
  assert.ok(nav.done.reduce((a, b) => a + b, 0) < nav.done.length / 3, 'only the tiles near the route were worked out');
});
