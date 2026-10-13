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
  assert.ok(nav.tiles.size < (nav.tx * nav.tz) / 3, 'only the tiles near the route were worked out');
});

test('a walk across the Hearthlands goes by road: quick, and the walking grid stays small', async () => {
  const { stressWorld } = await import('./stressworld.js');
  const { buildRoads } = await import('../../shared/world.js');
  const { world: w, towns } = stressWorld();
  setWorld(w);
  const col = buildColliders();
  const nav = new NavGrid(col, { roads: buildRoads() });
  const [a, b] = [towns[0], towns[6]]; // opposite sides of the ring: 1.4 km apart over the sea
  // The first crossing works out the road's stretches (kept for every later walk)...
  let t0 = performance.now();
  assert.ok(nav.findPath(a.x - 25, a.z - 30, b.x + 15, b.z - 20));
  const cold = performance.now() - t0;
  // ...after which a crossing from anywhere to anywhere is quick. (Best of
  // three, so other tests running alongside don't make it look slow.)
  let p;
  let ms = Infinity;
  for (const dx of [0, 4, -4]) {
    t0 = performance.now();
    p = nav.findPath(a.x + 30 + dx, a.z + 10, b.x - 20, b.z + 25 + dx);
    ms = Math.min(ms, performance.now() - t0);
  }
  p = nav.findPath(a.x + 30, a.z + 10, b.x - 20, b.z + 25);
  assert.ok(p && p.length > 5, 'found a way round');
  const end = p[p.length - 1];
  assert.ok(Math.hypot(end[0] - (b.x - 20), end[1] - (b.z + 25)) < 1, 'it ends where asked');
  let len = 0;
  let [x, z] = [a.x + 30, a.z + 10];
  for (const [px, pz] of p) {
    assert.ok(nav.clear(x, z, px, pz), `every leg is walkable (${x.toFixed(1)},${z.toFixed(1)} → ${px.toFixed(1)},${pz.toFixed(1)})`);
    len += Math.hypot(px - x, pz - z);
    [x, z] = [px, pz];
  }
  assert.ok(len < 2600, `the long way round, by road (${len.toFixed(0)} m)`);
  assert.ok(cold < 150, `the first crossing took ${cold.toFixed(1)} ms`);
  assert.ok(ms < 20, `route took ${ms.toFixed(1)} ms`);
  assert.ok(nav.bytes < 512 * 1024, `walking grid holds ${(nav.bytes / 1024).toFixed(0)} KB`);
});
