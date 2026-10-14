// The world and its content together (SPEC Phase 3 I3): the shipped map
// with its patches holds every town's kit and the density rules, every
// recipe input has a source, every material has a use, every quest step
// points at something real, the fights sit on the curve, and Amberfold's
// models stay out of the first load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { current as currentMap } from '../map.js';
import { REGIONS, LANDMARKS, SPAWNS, STONES, LAKES, NODES, ENTRANCES, PROPS, GATES, SPAWN, NavGrid, buildColliders, gateColliders, pathSegments } from '../../shared/world.js';
import { mapLints } from '../../shared/mapkit.js';
import { townAt } from '../../shared/places.js';
import { ITEMS } from '../../shared/items.js';
import { NODE_TYPES } from '../../shared/nodes.js';
import { MONSTERS } from '../../shared/monsters.js';
import { RECIPES } from '../../shared/recipes.js';
import { FISH_TABLES } from '../../shared/fishing.js';
import { CHESTS } from '../../shared/dungeon.js';
import { QUESTS } from '../../shared/quests.js';
import { ordersOf } from '../../shared/orders.js';
import { suppliesOf } from '../../shared/economy.js';
import { CONTENT, PACK_IDS } from '../../shared/content/index.js';
import { GROUPS, MODELS } from '../../client/src/scene/manifest/index.js';
import { fightRows } from '../../scripts/sim/fight.mjs';
import { hoursToLevel } from '../../scripts/sim/pace.mjs';
import { harness } from './harness.js';

const TOWNS = ['hearthvale', ...PACK_IDS];
const inside = (r, e) => Math.hypot(e.x - r.x, e.z - r.z) < r.r;

test('every town has its kit, and the map has no lints but known ones', () => {
  for (const t of TOWNS) assert.ok(REGIONS.some((r) => r.id === t && r.kind === 'town'), `${t} is on the map`);
  const lints = mapLints(currentMap.map).filter((l) => !(l.kind === 'town kit' && /^Hearthvale is missing a supplier stall/.test(l.text)));
  assert.deepEqual(lints.map((l) => `${l.kind}: ${l.text}`), []);
});

test('every wild region: a view, two caches, water, two camps and a waystone; caches off the road', () => {
  const segs = pathSegments().filter((s) => s[4] >= 2.5);
  const segDist = (x, z, [ax, az, bx, bz]) => {
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
  };
  for (const r of REGIONS.filter((x) => x.kind === 'wild')) {
    const lm = (kind) => LANDMARKS.filter((l) => l.kind === kind && inside(r, l)).length;
    assert.ok(lm('vista') >= 1, `${r.name}: a vista`);
    assert.ok(lm('cache') >= 2, `${r.name}: two caches`);
    assert.ok(LAKES.some((l) => inside(r, l)), `${r.name}: a lake`);
    assert.ok(SPAWNS.filter((s) => inside(r, s)).length >= 2, `${r.name}: two camps`);
    assert.ok(STONES.some((s) => inside(r, s)), `${r.name}: a waystone`);
  }
  for (const c of LANDMARKS.filter((l) => l.kind === 'cache' && townAt(l.x, l.z)?.id !== 'hearthvale')) assert.ok(Math.min(...segs.map((s) => segDist(c.x, c.z, s))) >= 20, `${c.id} is 20 m off the road`);
  // Camps keep 40 m apart.
  const camps = SPAWNS.filter((s) => !inside({ x: 0, z: 0, r: 96 }, s));
  for (const a of camps) for (const b of camps) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 40, `${a.id} and ${b.id} are 40 m apart`);
});

test('every recipe input has a source, and every material has a use', () => {
  const made = new Set();
  for (const t of Object.values(NODE_TYPES)) for (const d of [...t.drops, ...t.rare]) made.add(d.id);
  for (const m of Object.values(MONSTERS)) for (const d of m.drops) made.add(d.id);
  for (const r of RECIPES) made.add(r.out);
  for (const t of Object.values(FISH_TABLES)) for (const f of [...t.fish.map((x) => x.id), ...t.legends]) made.add(f);
  for (const c of Object.values(CHESTS)) for (const e of [...c.vault.table, ...c.boss.table]) for (const id of [].concat(e.id ?? [])) made.add(id);
  for (const t of TOWNS) for (const id of suppliesOf(t)) made.add(id);
  for (const q of Object.values(QUESTS)) for (const id of [...Object.keys(q.give ?? {}), ...Object.keys(q.reward?.items ?? {})]) made.add(id);
  for (const r of RECIPES) for (const id of Object.keys(r.in)) assert.ok(made.has(id), `${r.id} needs ${id}, which nothing gives`);
  // Every resource and material is wanted by a recipe or an order (legends, junk and keepsakes aside).
  const wanted = new Set([...RECIPES.flatMap((r) => Object.keys(r.in)), ...TOWNS.flatMap((t) => ordersOf(t).map((o) => o.item))]);
  for (const [id, it] of Object.entries(ITEMS)) {
    assert.ok(it.tag, `${id} has a tag`);
    if (!['resource', 'material'].includes(it.cat) || it.rarity === 'legendary' || id === 'old_boot') continue;
    assert.ok(wanted.has(id), `${id} is used by a recipe or an order`);
  }
});

test("every quest step's target is on the map", () => {
  for (const q of Object.values(QUESTS))
    for (const st of q.steps) {
      const t = st.target ?? {};
      const what = `${q.id}: ${st.text}`;
      if (t.kind === 'stone') assert.ok(STONES.some((s) => s.id === t.id), what);
      if (t.kind === 'landmark') assert.ok(t.id ? LANDMARKS.some((l) => l.id === t.id) : LANDMARKS.some((l) => l.kind === t.lk), what);
      if (t.kind === 'node') assert.ok(NODES.some((n) => n.type === t.type), what);
      if (t.kind === 'monster') assert.ok(SPAWNS.some((s) => s.monster === t.type), what);
      if (t.kind === 'entrance') assert.ok(ENTRANCES.some((e) => e.kind === t.dungeon), what);
      if (t.kind === 'station') assert.ok(PROPS.some((p) => p.station === t.station && (!t.town || townAt(p.x, p.z)?.id === t.town)), what);
      if (t.kind === 'building' && t.town) assert.ok(currentMap.map.buildings.some((b) => b.action === t.action && townAt(b.x, b.z)?.id === t.town), what);
    }
});

test('fights sit on the curve: arriving is a fair fight, the Elder wants friends, leaving is easy', () => {
  for (const r of fightRows('amberfold')) {
    if (r.boss) {
      assert.ok(r.arrive.pct > 100, `${r.id}: too much for one hero arriving (${r.arrive.pct}%)`);
      assert.ok(r.duo.pct <= 75, `${r.id}: a duo manages it (${r.duo.pct}%)`);
      assert.ok(r.leave.pct <= 80, `${r.id}: solo once geared (${r.leave.pct}%)`);
    } else {
      assert.ok(r.arrive.rounds >= 3 && r.arrive.rounds <= 5 && r.arrive.pct >= 10 && r.arrive.pct <= 60, `${r.id} arriving: ${r.arrive.rounds} rounds, ${r.arrive.pct}%`);
      assert.ok(r.leave.pct <= 30, `${r.id} leaving: ${r.leave.pct}%`);
    }
  }
  // Skill 12 → 18 on Amberfold's nodes takes an hour or two of focused play.
  for (const n of ['tree_maple', 'rock_coal', 'herb_hearthcap']) assert.ok(hoursToLevel(n) > 1 && hoursToLevel(n) < 3, `${n}: ${hoursToLevel(n).toFixed(1)} h`);
});

test('the West Gate: the road starts in its arch, you can walk through it, and Amberfold can be walked to', () => {
  const west = GATES.find((g) => g.id === 'gate_west');
  assert.ok(west && GATES[0].id === 'gate');
  assert.deepEqual(currentMap.map.paths.find((p) => p.id === 'road_westmarch').pts[0], [west.x, west.z]);
  const nav = new NavGrid(buildColliders());
  // Just inside the gate to just outside: straight through the arch.
  const path = nav.findPath(west.x + 8, west.z, west.x - 8, west.z);
  assert.ok(path);
  let [ax, az] = [west.x + 8, west.z];
  for (const [bx, bz] of path) {
    if ((ax - west.x) * (bx - west.x) <= 0 && ax !== bx) {
      const z = az + ((bz - az) * (west.x - ax)) / (bx - ax);
      assert.ok(Math.abs(z - west.z) < 1.3, `crosses the wall line at z=${z.toFixed(1)}, not through the arch`);
    }
    [ax, az] = [bx, bz];
  }
  // The wall runs north–south, and the square to Amberfold is one walk.
  for (const c of gateColliders(west).filter((c) => Math.max(c.w, c.d) > 10)) assert.ok(c.d > c.w, 'a turned gate: its walls run north–south');
  const to = nav.nearestOpen(-534, -50);
  assert.ok(nav.findPath(SPAWN.x, SPAWN.z, to[0], to[1]), 'Amberfold can be walked to');
});

test('the Amberfold Town Hall takes the letter (and only there)', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Robin');
    game.quests.skipTo(c, 'hv_intro', 9);
    game.quests.start(c, 'af_intro');
    assert.equal(game.heroes.count(c.id, 'letter_amberfold'), 1);
    Object.assign(c.ent, { x: 16, z: 17.5 }); // Hearthvale's hall
    assert.throws(() => game.landmarks.returnCurios(c), /nothing for this town hall/);
    Object.assign(c.ent, { x: -524, z: -48 }); // Amberfold's
    assert.deepEqual(game.landmarks.returnCurios(c).letters, ['letter_amberfold']);
    assert.equal(c.quests.get('af_intro|0').step, 1);
  } finally {
    done();
  }
});

test("Amberfold's models stay out of the first load", () => {
  const core = new Set(GROUPS.core.flatMap((s) => [].concat(MODELS[s].url)));
  for (const id of ['biome:autumn', 'mobs:amberfold', 'kit:cave']) assert.ok(GROUPS[id]?.length, id);
  // The files Phase 3 brought are only ever loaded with those groups.
  const NEW = ['nature-kit/tree_oak_fall', 'nature-kit/tree_tall_fall', 'nature-kit/tree_simple_fall', 'nature-kit/tree_cone_fall', 'nature-kit/crop_pumpkin', 'nature-kit/statue_ring', 'nature-kit/log_stackLarge', 'graveyard-kit/pine-fall', 'graveyard-kit/pumpkin', 'graveyard-kit/hay-bale', 'fantasy-town-kit/windmill', 'survival-kit/tree-autumn-tall', 'cave/template-wall'];
  for (const f of NEW) assert.ok(![...core].some((u) => u.includes(`/${f}.glb`)), `${f} is not in the first load`);
  // Every Amberfold monster has a model in its group, and every camp's monster exists.
  for (const id of Object.keys(CONTENT.monsters)) assert.ok(GROUPS['mobs:amberfold'].includes(`mob_${id}`), `mob_${id}`);
  for (const t of ['tree_maple', 'rock_coal', 'herb_hearthcap']) assert.ok(GROUPS['biome:autumn'].includes(t), t);
});
