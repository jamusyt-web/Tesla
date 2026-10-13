import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scatterPoints, openGround, CHUNK } from '../../client/src/scene/scatter.js';

// One square of land with a path, a plaza, a building, a node and a lake in it.
const near = {
  lands: [{ x: 48, z: 48, r: 400 }],
  segs: [[0, 20, 96, 20, 1.5]],
  plazas: [{ x: 70, z: 70, r: 8 }],
  buildings: [{ x: 20, z: 60, w: 8, d: 6 }],
  nodes: [{ x: 50, z: 50, r: 1 }],
  lakes: [{ x: 30, z: 80, r: 6 }],
};
const rules = [
  { slot: 'deco_bush', per100m2: 2, s: [0.8, 1.2] },
  { slot: 'deco_reed', per100m2: 3, s: [1, 1], nearWater: true },
];

test('scatter is deterministic', () => {
  const a = scatterPoints(0, 0, rules, near, 7);
  const b = scatterPoints(0, 0, rules, near, 7);
  assert.deepEqual(a, b);
  assert.ok(a.length > 50);
  assert.notDeepEqual(a, scatterPoints(1, 0, rules, near, 7), 'another square differs');
});

test('scatter keeps off paths, plazas, buildings, nodes and lakes', () => {
  const pts = scatterPoints(0, 0, rules, near, 7);
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= CHUNK && p.z >= 0 && p.z <= CHUNK);
    assert.ok(Math.abs(p.z - 20) > 1.5, 'path');
    assert.ok(Math.hypot(p.x - 70, p.z - 70) > 8, 'plaza');
    assert.ok(!(Math.abs(p.x - 20) < 4 && Math.abs(p.z - 60) < 3), 'building');
    assert.ok(Math.hypot(p.x - 50, p.z - 50) > 1, 'node');
    assert.ok(Math.hypot(p.x - 30, p.z - 80) > 6, 'lake');
    assert.ok(p.v >= 0 && p.v < 3);
  }
  const reeds = pts.filter((p) => p.slot === 'deco_reed');
  assert.ok(reeds.length > 0 && reeds.every((p) => Math.hypot(p.x - 30, p.z - 80) < 12), 'nearWater stays on the shore');
  assert.equal(openGround(48, 20, near), false);
  assert.equal(openGround(48, 40, near), true);
});

test('no rules, no cover (meadow)', () => {
  assert.deepEqual(scatterPoints(0, 0, [], near, 7), []);
  assert.deepEqual(scatterPoints(0, 0, undefined, near, 7), []);
});
