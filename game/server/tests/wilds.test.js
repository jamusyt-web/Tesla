// The living wilds (shared/wilds.js): nodes regrow as better variants now
// and then, the clock's rich and ancient states still come and go, and a
// golden node pays its keepsake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ST, STATE_FX, ODDS, rollVariant, variantName, hpOf, yieldOf, keepsakeOf } from '../../shared/wilds.js';
import { NODE_TYPES } from '../../shared/nodes.js';
import { ITEMS } from '../../shared/items.js';
import { mulberry32, NODES, REGIONS, buildColliders, isWalkable } from '../../shared/world.js';
import '../map.js';
import { regrow, spend, seedVariants, tickNodeStates, stateOf } from '../nodestates.js';
import { initGroves, fell, tickGroves, groveFill } from '../groves.js';
import { eventsAt, eventText, SLOT_MS } from '../../shared/worldevents.js';
import { startHere, finish, activeEvents } from '../worldevents.js';
import { MONSTERS } from '../../shared/monsters.js';
import { grantGather } from '../gather.js';
import { harness } from './harness.js';

const fakeChannel = (nodes) => ({ nodes: new Map(nodes.map((n) => [n.id, n])), players: new Map(), sent: [], broadcast(m) { this.sent.push(m); } });
const node = (id, type, extra = {}) => ({ id, type, x: 30, z: 0, hp: NODE_TYPES[type].hp, alive: true, respawnAt: 0, hitters: new Set(), ...extra });

test('variants roll at about their odds, only for trees, rocks and herbs', () => {
  const rng = mulberry32(7);
  const count = { 0: 0, 3: 0, 4: 0, 5: 0 };
  const N = 200_000;
  for (let i = 0; i < N; i++) count[rollVariant('tree_oak', rng)]++;
  for (const st of [ST.big, ST.elder, ST.golden]) assert.ok(Math.abs(count[st] / N - ODDS[st]) < ODDS[st] * 0.25, `${st}: ${count[st] / N} vs ${ODDS[st]}`);
  assert.equal(rollVariant('fish_spot', () => 0), ST.plain, 'fishing spots have no variants');
  assert.equal(rollVariant('tree_oak', () => 0), ST.golden);
});

test('a variant is bigger, tougher and gives more; a golden one has a keepsake that exists', () => {
  assert.equal(variantName('tree_oak', ST.golden), 'Golden Oak Tree');
  assert.equal(variantName('rock_iron', ST.big), 'Hefty Iron Vein');
  assert.equal(variantName('herb_mint', 0), 'Mint');
  assert.equal(hpOf('tree_oak', ST.big), Math.round(NODE_TYPES.tree_oak.hp * 1.5));
  assert.equal(yieldOf(3, ST.big), 5);
  for (const st of [ST.big, ST.elder, ST.golden]) assert.equal(STATE_FX[st].gate, 0, 'no level gate: anyone who can work the plain one can work it');
  for (const t of ['tree_oak', 'rock_stone', 'herb_mint']) assert.ok(ITEMS[keepsakeOf(t)], t);
});

test('regrowing rolls a variant; falling spends it; the clock never wipes it', () => {
  const ch = fakeChannel([node('a', 'tree_oak'), node('b', 'tree_oak')]);
  const a = ch.nodes.get('a');
  regrow(ch, a, () => 0.0001); // golden
  assert.equal(stateOf(a), ST.golden);
  assert.equal(a.hp, hpOf('tree_oak', ST.golden));
  tickNodeStates(ch, Date.now());
  assert.equal(stateOf(a), ST.golden, 'still golden after the clock looked');
  spend(ch, a);
  assert.equal(stateOf(a), 0);
  regrow(ch, a, () => 0.99);
  assert.equal(stateOf(a), 0, 'and it can come back plain');
  // Seeding a day's variants is the same on every channel.
  const one = fakeChannel(Array.from({ length: 300 }, (_, i) => node(`n${i}`, 'tree_birch')));
  const two = fakeChannel(Array.from({ length: 300 }, (_, i) => node(`n${i}`, 'tree_birch')));
  seedVariants(one.nodes, 20000);
  seedVariants(two.nodes, 20000);
  assert.deepEqual([...one.nodes.values()].map(stateOf), [...two.nodes.values()].map(stateOf));
  assert.ok([...one.nodes.values()].some((n) => stateOf(n) === ST.big), 'some sturdy ones among 300');
});

test('a shifting grove: about 60% full, a felled tree regrows as a sapling elsewhere, never where someone stands', () => {
  const slots = Array.from({ length: 20 }, (_, i) => node(`g${i}`, 'tree_oak', { x: i * 6, z: 0, grove: 'g' }));
  const ch = fakeChannel(slots);
  initGroves(ch);
  const full = () => groveFill(ch).g[0];
  assert.deepEqual(groveFill(ch).g, [12, 20]);
  let now = 1_000_000;
  const rng = mulberry32(5);
  for (let k = 0; k < 200; k++) {
    // Someone stands on one empty slot; fell a random standing tree.
    const gone = slots.filter((s) => s.g === 'gone');
    const stand = gone[k % gone.length];
    ch.players = new Map([[1, { ent: { x: stand.x, z: stand.z } }]]);
    const up = slots.filter((s) => s.alive);
    const n = up[Math.floor(rng() * up.length)];
    n.alive = false;
    const s = fell(ch, n, now, 18_000, rng);
    assert.ok(s && s !== stand, 'a sapling, not under anyone');
    assert.equal(full(), 12, 'the grove stays as full');
    now += 20_000;
    for (const x of slots) if (x.g === 'sapling' && now >= x.respawnAt) Object.assign(x, { alive: true, g: null, hp: 6 });
    tickGroves(ch, slots, now);
  }
  assert.ok(slots.every((s) => s.g !== 'sapling' || !s.alive));
  assert.ok(ch.sent.some((m) => m.g === 'sapling') && ch.sent.some((m) => m.g === 'gone'));
});

test("the Deepwood is on the map: groves of trees, herbs and rocks, a glade stone, and grove trees don't block", () => {
  const groves = new Set(NODES.filter((n) => n.grove).map((n) => n.grove));
  for (const g of ['dw_oaks', 'dw_pines', 'dw_maples', 'dw_herbs', 'dw_stones', 'aw_orchard']) assert.ok(groves.has(g), g);
  assert.ok(REGIONS.some((r) => r.id === 'deepwood' && r.biome === 'deepwood'));
  const col = buildColliders();
  const oak = NODES.find((n) => n.grove === 'dw_oaks' && n.type === 'tree_oak');
  assert.ok(isWalkable(oak.x, oak.z, col), 'you brush through a grove tree');
});

test('world events: the same everywhere, often, varied, and each one points at something real', () => {
  const day = 86_400_000;
  const t0 = 20_000 * day;
  const seen = {};
  let slots = 0;
  for (let s = 0; s < 6 * 24; s++) {
    const now = t0 + s * SLOT_MS + 5 * 60_000;
    const a = eventsAt(now);
    assert.deepEqual(eventsAt(now), a, 'deterministic');
    if (a.length) slots++;
    for (const e of a) {
      seen[e.kind] = (seen[e.kind] ?? 0) + 1;
      assert.ok(REGIONS.some((r) => r.id === e.region), e.region);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.z) && e.end > e.start);
      if (e.kind === 'growth') assert.ok(NODES.some((n) => n.grove === e.target));
      if (e.kind === 'stampede') assert.ok(MONSTERS[e.monster]);
      assert.ok(eventText(e).length > 10);
    }
  }
  assert.ok(slots > 6 * 24 * 0.8, `something is on almost always (${slots} of ${6 * 24})`);
  for (const k of ['growth', 'golden', 'frenzy', 'stampede', 'goblin']) assert.ok(seen[k] > 0, `${k} happens`);
});

test('an event on a channel: a stampede charges out and leaves; a growing rain fills a grove; a frenzy speeds bites', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Fen');
    const ch = c.ch;
    Object.assign(c.ent, { x: 0, z: -50 }); // the Wilds
    const before = ch.mobs.size;
    const e = startHere(ch, c, 'stampede');
    assert.equal(ch.mobs.size, before + 5);
    const mob = [...ch.mobs.values()].find((m) => m.once);
    assert.match(ch.monsterDef(mob).name, /^Stampeding /);
    assert.ok(c.sent.some((m) => m.t === 'wev' && m.id === e.id));
    finish(ch, e.id, ch.wev.get(e.id));
    assert.equal(ch.mobs.size, before, 'gone when it ends');
    // A growing rain: every empty slot of the grove sprouts.
    Object.assign(c.ent, { x: -180, z: -85 });
    const g = startHere(ch, c, 'growth');
    assert.ok(ch.groves.get(g.target).every((s) => s.g !== 'gone'));
    // A frenzy: bites in under 2 s.
    Object.assign(c.ent, { x: -575, z: -82 });
    const f = startHere(ch, c, 'frenzy');
    assert.equal(f.target, 'mill_pond');
    assert.ok(activeEvents(ch).some((x) => x.kind === 'frenzy'));
  } finally {
    done();
  }
});

test('felling a golden tree: more logs, the sure rare, the keepsake, and a journal find', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Lark');
    const n = node('g1', 'tree_oak', { st: ST.golden });
    grantGather(game, c, NODE_TYPES.tree_oak, n, true);
    assert.equal(game.heroes.count(c.id, 'golden_seed'), 1);
    assert.equal(game.heroes.count(c.id, 'golden_acorn'), 1, 'the sure rare');
    assert.ok(game.heroes.count(c.id, 'oak_log') >= 2 * 3, 'three times the logs');
    assert.ok(game.journal.has(c.id, 'variant', 'tree_oak:5'));
  } finally {
    done();
  }
});
