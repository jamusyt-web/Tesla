import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNodes, generateScenery, buildColliders, approachPoint, NavGrid, SPAWN, BUILDINGS, doorPoint, NODE_TYPES, INTERACT_RANGE, FISH_RANGE } from '../../shared/world.js';

const nodes = generateNodes();
const col = buildColliders(nodes, generateScenery());
const nav = new NavGrid(col);

test('every gatherable node can be reached and worked from its stand-point', () => {
  for (const n of nodes) {
    const ap = approachPoint(n, SPAWN.x, SPAWN.z, col);
    assert.ok(ap, `${n.id} (${n.type}) has a stand-point`);
    const path = nav.findPath(SPAWN.x, SPAWN.z, ap[0], ap[1]);
    assert.ok(path, `${n.id} (${n.type}) at ${n.x},${n.z} is reachable`);
    const end = path[path.length - 1];
    const t = NODE_TYPES[n.type];
    const range = t.kind === 'fish' ? FISH_RANGE : INTERACT_RANGE + t.r * n.s + 0.4;
    assert.ok(Math.hypot(end[0] - n.x, end[1] - n.z) <= range, `${n.id} is in range from where you end up`);
  }
});

test('every building door is reachable', () => {
  for (const b of BUILDINGS) {
    const [x, z] = doorPoint(b);
    assert.ok(nav.findPath(SPAWN.x, SPAWN.z, x, z), `${b.id} door`);
  }
});
