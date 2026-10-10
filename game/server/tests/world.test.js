import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNodes, generateScenery, buildColliders, approachPoint, NavGrid, SPAWN, BUILDINGS, doorPoint, NODE_TYPES, INTERACT_RANGE, FISH_RANGE, WORLD_RADIUS, LAKE, DOCK } from '../../shared/world.js';

const nodes = generateNodes();
const col = buildColliders(nodes, generateScenery());
const nav = new NavGrid(col);

// The hard rule for any route: never through a building, over water or off
// the island. (Brushing the edge of a tree or rock is fine.)
function solid(x, z) {
  if (Math.hypot(x, z) > WORLD_RADIUS + 0.05) return 'off the island';
  const dock = Math.abs(x - DOCK.x) <= DOCK.w / 2 && Math.abs(z - DOCK.z) <= DOCK.d / 2;
  if (!dock && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r - 0.05) return 'water';
  for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 - 0.05 && Math.abs(z - b.z) < b.d / 2 - 0.05) return `inside ${b.id}`;
  return null;
}
function hopProblem(ax, az, bx, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1));
  for (let i = 0; i <= n; i++) {
    const w = solid(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
    if (w) return w;
  }
  return null;
}

test('every gatherable node can be reached and worked from its stand-point', () => {
  for (const n of nodes) {
    const ap = approachPoint(n, SPAWN.x, SPAWN.z, col, nav);
    assert.ok(ap, `${n.id} (${n.type}) has a stand-point`);
    const path = nav.findPath(SPAWN.x, SPAWN.z, ap[0], ap[1]);
    assert.ok(path, `${n.id} (${n.type}) at ${n.x},${n.z} is reachable`);
    // The whole route must be walkable, hop by hop.
    let [ax, az] = [SPAWN.x, SPAWN.z];
    for (const [bx, bz] of path) {
      const bad = hopProblem(ax, az, bx, bz);
      assert.equal(bad, null, `${n.id}: hop ${ax.toFixed(1)},${az.toFixed(1)} -> ${bx.toFixed(1)},${bz.toFixed(1)} goes ${bad}`);
      [ax, az] = [bx, bz];
    }
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

test('random paths never go through buildings, water or off the island, and are never empty', () => {
  let a = 12345;
  const rnd = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
  let checked = 0;
  for (let i = 0; i < 1500; i++) {
    const sx = (rnd() - 0.5) * 180;
    const sz = (rnd() - 0.5) * 180;
    if (!nav.clear(sx, sz, sx, sz)) continue; // start must be somewhere a hero can stand
    const tx = (rnd() - 0.5) * 190;
    const tz = (rnd() - 0.5) * 190;
    const path = nav.findPath(sx, sz, tx, tz);
    if (!path) continue;
    assert.ok(path.length > 0, 'a found path has at least one waypoint');
    let [ax, az] = [sx, sz];
    for (const [bx, bz] of path) {
      const bad = hopProblem(ax, az, bx, bz);
      assert.equal(bad, null, `hop ${ax.toFixed(2)},${az.toFixed(2)} -> ${bx.toFixed(2)},${bz.toFixed(2)} goes ${bad} (goal ${tx.toFixed(1)},${tz.toFixed(1)})`);
      [ax, az] = [bx, bz];
    }
    checked++;
  }
  assert.ok(checked > 300, `checked ${checked} paths`);
});
