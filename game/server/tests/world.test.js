import { test } from 'node:test';
import assert from 'node:assert/strict';
import { current as currentMap, serverMapProblems, SHIPPED_MAP } from '../map.js';
import { NODES, SPAWNS, PROPS, upgradeMap, setWorld, isWalkable, landDistance, buildColliders, approachPoint, NavGrid, SPAWN, BUILDINGS, doorPoint, NODE_TYPES, INTERACT_RANGE, FISH_RANGE, WORLD_RADIUS, LAKES, DOCKS, GATE, GATES, gateColliders, SWING_GATE, SWING_FLOOR, isPerfectSwing, mapProblems } from '../../shared/world.js';
import { ITEMS } from '../../shared/items.js';
import { MODELS } from '../../client/src/scene/manifest/index.js';
import { PROC_BUILDERS } from '../../client/src/scene/procprops.js';

const nodes = NODES;
const col = buildColliders();
const nav = new NavGrid(col);

// The hard rule for any route: never through a building, over water or off
// the island. (Brushing the edge of a tree or rock is fine.)
function solid(x, z) {
  if (Math.hypot(x, z) > WORLD_RADIUS + 0.05) return 'off the island';
  const dock = DOCKS.some((d) => Math.abs(x - d.x) <= d.w / 2 && Math.abs(z - d.z) <= d.d / 2);
  if (!dock && LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r - 0.05)) return 'water';
  for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 - 0.05 && Math.abs(z - b.z) < b.d / 2 - 0.05) return `inside ${b.id}`;
  for (const g of GATES.flatMap((gt) => gateColliders(gt))) if (Math.abs(x - g.x) < g.w / 2 - 0.05 && Math.abs(z - g.z) < g.d / 2 - 0.05) return 'through the gate wall';
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

test('the road to the Wilds goes through the gate arch, and every monster camp is reachable', () => {
  const path = nav.findPath(SPAWN.x, SPAWN.z, GATE.x, GATE.z - 10);
  assert.ok(path, 'the Wilds are reachable from town');
  let [ax, az] = [SPAWN.x, SPAWN.z];
  for (const [bx, bz] of path) {
    assert.equal(hopProblem(ax, az, bx, bz), null);
    if ((az - GATE.z) * (bz - GATE.z) <= 0) {
      const x = ax + ((bx - ax) * (GATE.z - az)) / (bz - az || 1);
      assert.ok(Math.abs(x - GATE.x) < 1.25, `crosses the wall line at x=${x.toFixed(2)}, not through the arch`);
    }
    [ax, az] = [bx, bz];
  }
  for (const sp of SPAWNS) {
    const p = nav.nearestOpen(sp.x, sp.z);
    assert.ok(p && nav.findPath(SPAWN.x, SPAWN.z, p[0], p[1]), `${sp.monster} camp ${sp.id} at ${sp.x},${sp.z} is reachable`);
  }
});

test('the shipped map is valid, and every prop has a model or a procedural kind', () => {
  assert.equal(currentMap.file, SHIPPED_MAP);
  assert.deepEqual(serverMapProblems(currentMap.map), []);
  for (const p of PROPS) assert.ok(MODELS[p.slot] || PROC_BUILDERS[p.slot], `${p.id}: unknown slot ${p.slot}`);
  assert.ok(PROPS.filter((p) => p.station).length === 5, 'five crafting stations');
  for (const id of ['workshop', 'market', 'shop', 'townhall']) assert.ok(BUILDINGS.some((b) => b.id === id), `${id} building`);
});

test('broken maps are rejected with readable reasons', () => {
  const good = currentMap.map;
  const clone = () => JSON.parse(JSON.stringify(good));
  const dupe = clone();
  dupe.props[1].id = dupe.props[0].id;
  assert.match(mapProblems(dupe).join(), /used twice/);
  const typo = clone();
  typo.nodes[0].type = 'tree_banana';
  assert.match(mapProblems(typo).join(), /unknown node type "tree_banana"/);
  const noXY = clone();
  delete noXY.buildings[0].x;
  assert.match(mapProblems(noXY).join(), /workshop\) needs numeric x and z/);
  const badMob = clone();
  badMob.spawns[0].monster = 'dragon';
  assert.match(serverMapProblems(badMob).join(), /unknown monster "dragon"/);
  assert.deepEqual(mapProblems({ ...clone(), format: 3 }).slice(0, 1), ['Unknown map format 3 (expected 2).']);
});

test('old (format 1) maps upgrade to lands', () => {
  const { lands, ...rest } = structuredClone(currentMap.map);
  const old = { ...rest, format: 1, bounds: { r: 96 } };
  const up = upgradeMap(old);
  assert.equal(up.format, 2);
  assert.deepEqual(up.lands, [{ id: 'island', x: 0, z: 0, r: 96 }]);
  assert.equal(up.bounds, undefined);
  assert.deepEqual(mapProblems(up), []);
  assert.equal(old.format, 1, 'the original is left alone');
});

test('swing rhythm: mashing can never score PERFECT, and on-beat swings always can', () => {
  for (const it of Object.values(ITEMS).filter((i) => i.speed)) {
    const P = it.speed;
    // The earliest a buffered (mashed) swing goes out is SWING_GATE·P, plus up to 120 ms of jitter either way.
    for (let since = P * SWING_GATE - 120; since <= P * SWING_GATE + 30; since += 5) assert.equal(isPerfectSwing(since, P), false, `${it.name}: mash at ${since | 0}ms`);
    for (let j = -60; j <= 60; j += 10) assert.ok(isPerfectSwing(P + j, P), `${it.name}: on the beat ±${j}ms`);
    assert.ok(SWING_FLOOR * P < SWING_GATE * P - 80, `${it.name}: server floor leaves jitter headroom`);
  }
});
