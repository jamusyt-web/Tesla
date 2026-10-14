// Amberfold's content pack (SPEC §4, Phase 3 W1a): everything it names
// exists, its monsters sit on the one curve, its nodes fit the band, its
// shops can't be played for a profit, and its welcome quest runs end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PACK from '../../shared/content/amberfold/index.js';
import { ITEMS, QUALITY_BASES } from '../../shared/items.js';
import { NODE_TYPES } from '../../shared/nodes.js';
import { MONSTERS, mobStats } from '../../shared/monsters.js';
import { RECIPES, RECIPE_BY_ID } from '../../shared/recipes.js';
import { FISH, FISH_TABLES, fishWeights } from '../../shared/fishing.js';
import { DUNGEONS, CHESTS, standardChests } from '../../shared/dungeon.js';
import { QUESTS } from '../../shared/quests.js';
import { ordersOf, orderOf } from '../../shared/orders.js';
import { STATIONS } from '../../shared/crafting.js';
import { unitBid, supplyAsk, suppliesOf, TRADE } from '../../shared/economy.js';
import { customersOf } from '../../shared/shop.js';
import { SETS } from '../../shared/sets.js';
import { NODE_BAND_MAX } from '../../shared/mapkit.js';
import { harness } from './harness.js';
import { emit } from '../events.js';

const T = 'amberfold';
const has = (id) => assert.ok(ITEMS[id], `item ${id}`);

test('every drop, input, output, catch and reward names a real item', () => {
  for (const n of Object.values(PACK.nodes)) for (const d of [...n.drops, ...n.rare]) has(d.id);
  for (const m of Object.values(PACK.monsters)) for (const d of m.drops) has(d.id);
  for (const r of PACK.recipes) {
    has(r.out);
    for (const id of Object.keys(r.in)) has(id);
    assert.ok(STATIONS[r.station], `${r.id}: station ${r.station}`);
  }
  for (const t of Object.values(PACK.fishTables)) for (const f of [...t.fish.map((x) => x.id), ...t.legends]) assert.ok(FISH[f] && ITEMS[f], f);
  for (const [kind, c] of Object.entries(PACK.chests)) for (const e of [...c.vault.table, ...c.boss.table]) for (const id of [].concat(e.id ?? [])) has(id);
  for (const q of PACK.quests) {
    for (const id of Object.keys(q.give ?? {})) has(id);
    for (const id of Object.keys(q.reward.items ?? {})) has(id);
    for (const st of q.steps) {
      if (st.match.item) has(st.match.item);
      if (st.match.monster) assert.ok(MONSTERS[st.match.monster], st.match.monster);
      if (st.match.kind && st.ev === 'dungeon') assert.ok(DUNGEONS[st.match.kind]);
      if (st.target?.type && st.target.kind === 'node') assert.ok(NODE_TYPES[st.target.type]);
    }
  }
  for (const s of suppliesOf(T)) has(s);
  for (const c of customersOf(T)) for (const id of c.likes) has(id);
  for (const t of ordersOf(T)) (t.item ? has(t.item) : assert.ok(MONSTERS[t.monster]), assert.ok(orderOf(t).qty >= 1));
  // Every item has a tag; trophies, letters, curios and kits can't be sold.
  for (const [id, it] of Object.entries(PACK.items)) assert.ok(it.tag, `${id} has a tag`);
  for (const id of ['trophy_amberfold', 'lost_scythe']) assert.ok(ITEMS[id].bound);
});

test('every material Amberfold makes or grows is wanted by a recipe or an order', () => {
  const used = new Set([...RECIPES.flatMap((r) => Object.keys(r.in)), ...ordersOf(T).map((t) => t.item)]);
  for (const [id, it] of Object.entries(PACK.items)) {
    if (!['resource', 'material'].includes(it.cat) || it.tag === 'fish' && FISH[id]?.legend) continue;
    assert.ok(used.has(id), `${id} is used somewhere`);
  }
});

test('monsters sit on the one curve (±15%), with two moves and a telegraph for bosses', () => {
  for (const [id, m] of Object.entries(PACK.monsters)) {
    const role = m.dungeon && m.boss ? 'dboss' : m.boss ? 'boss' : 'normal';
    const want = mobStats(m.lvl, role);
    for (const k of ['hp', 'atk', 'def', 'xp']) assert.ok(Math.abs(m[k] - want[k]) <= want[k] * 0.15, `${id} ${k}: ${m[k]} vs ${want[k]}`);
    assert.ok(m.moves.length >= 2);
    if (m.boss) assert.ok(m.telegraph?.move, `${id} telegraphs`);
  }
  // The band: Westmarch 11–13, Amberwood 12–17.
  for (const id of Object.keys(PACK.monsters)) assert.ok(MONSTERS[id].lvl >= 11 && MONSTERS[id].lvl <= 17, id);
});

test('nodes: skill 12, gold tools, inside the tier-2 band', () => {
  for (const [id, n] of Object.entries(PACK.nodes)) {
    assert.equal(n.lvl, 12, id);
    assert.ok(n.lvl <= NODE_BAND_MAX[2]);
    if (n.tool) assert.equal(n.tier, 4, `${id} needs a gold tool`);
  }
});

test('gear needs Combat 12; tools, rods and weapons come in three qualities, sets and charms in one', () => {
  for (const [id, it] of Object.entries(PACK.items)) if (it.cat === 'gear' && it.slot !== 'charm') assert.equal(it.req?.combat, 12, id);
  for (const id of ['axe_steel', 'pick_steel', 'rod_amber', 'steel_saber', 'steel_brigandine', 'amber_pendant']) assert.ok(QUALITY_BASES.includes(id) && ITEMS[`${id}~master`], id);
  for (const id of ['thornwood_blade', 'charm_forager_1', 'climbing_rope']) assert.ok(!QUALITY_BASES.includes(id), id);
  assert.ok(SETS.thornroot);
  for (const id of ['thornwood_blade', 'thornroot_jerkin', 'heartwood_amulet']) {
    assert.equal(ITEMS[id].set, 'thornroot');
    assert.ok(RECIPE_BY_ID[id].town === T && RECIPE_BY_ID[id].rep === 2, `${id}: Amberfold, Neighbour standing`);
  }
  assert.ok(Object.values(PACK.recipes).some((r) => r.station === 'smokehouse'));
  // Steel needs Hearthvale iron: the road gets walked both ways.
  assert.ok(RECIPE_BY_ID.steel_bar.in.iron_bar);
});

test("the shops can't be played: every supplier ask is above every merchant bid", () => {
  const fresh = { floorLeft: 1e9, premFill: 1 };
  for (const item of suppliesOf(T)) for (const town of Object.keys(TRADE)) assert.ok(supplyAsk(item) > unitBid(town, item, fresh), `${item} in ${town}`);
});

test('the Thornroot Warren: a cave kind with the standard chests', () => {
  const K = DUNGEONS.thornroot_warren;
  assert.equal(K.kit, 'cave');
  assert.equal(K.dust, 'heartwood_sap');
  for (const id of [...K.pool, ...K.elite, K.boss.monster, ...K.boss.adds]) assert.ok(MONSTERS[id]?.dungeon, id);
  const want = standardChests({ rec1: K.tiers[1], bar: 'steel_bar', food: 'carp_chowder', gem: 'amber_sap', sets: ['thornwood_blade', 'thornroot_jerkin', 'heartwood_amulet'], charm: 'charm_forager_1' });
  assert.deepEqual(CHESTS.thornroot_warren, want);
});

test('the Mill Pond: rivercarp in the shallows, Grandfather Carp only in deep water while the leaves fall', () => {
  const at = (deep, weather, rod = 4, lvl = 20) => Object.fromEntries(fishWeights('amberfold', rod, lvl, deep, { weather }).map((f) => [f.id, f.w]));
  assert.ok(at(false, null, 1, 12).rivercarp > at(false, null, 1, 12).leaf_eel);
  assert.ok(!at(false, 'leaves').legend_millcarp);
  assert.ok(!at(true, null).legend_millcarp);
  assert.ok(at(true, 'leaves').legend_millcarp > 0);
  assert.ok(!at(true, 'leaves', 3).legend_millcarp, 'it needs an Amberline Rod');
  assert.equal(FISH_TABLES.amberfold.lvl, 12);
});

test('af_intro: at the Westmarch Stones you get a letter; the steps run end to end', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Wren');
    assert.ok(QUESTS.af_intro.requires.includes('hv_intro'));
    game.quests.skipTo(c, 'hv_intro', 9);
    c.hero.stones = [...(c.hero.stones ?? []), 'stone_westmarch'];
    emit(c, 'attune', { id: 'stone_westmarch' });
    assert.ok(c.questsDone.has('hv_intro'));
    assert.equal(c.quests.get('af_intro|0')?.step, 1, 'af_intro starts, and its first step (the Stones) is already done');
    assert.equal(game.heroes.count(c.id, 'letter_amberfold'), 1, 'with the letter');
    // (Handing it in at the town hall itself is in world-content.test.js.)
    assert.throws(() => game.landmarks.returnCurios(c), /nothing for this town hall|Town Hall door/, "Hearthvale's hall won't take it");
    emit(c, 'deliver', { kind: 'letter', item: 'letter_amberfold', qty: 1, town: T });
    assert.equal(c.quests.get('af_intro|0').step, 2, 'delivered: on to the waystone');
    assert.ok(c.quests.has('af_woods|0'), 'the Turning Woods opens on the way');
    emit(c, 'attune', { id: 'stone_amberfold' });
    for (let i = 0; i < 5; i++) emit(c, 'sell', { item: 'coal', qty: 1, town: T });
    assert.equal(c.quests.get('af_intro|0').step, 4);
    emit(c, 'craft', { out: 'carp_chowder', item: 'carp_chowder', qty: 1, station: 'cookpot' });
    assert.equal(c.quests.get('af_intro|0').step, 4, 'the cookpot is not the Smokehouse');
    emit(c, 'craft', { out: 'venison_skewer', item: 'venison_skewer', qty: 1, station: 'smokehouse' });
    emit(c, 'order', { town: T, key: 'af_maple' });
    const gold = game.heroes.gold(c.id);
    emit(c, 'kill', { monster: 'antlered_elder' });
    assert.ok(c.questsDone.has('af_intro'));
    assert.equal(game.heroes.gold(c.id) - gold, 120 + 400);
    assert.ok(c.quests.has('af_mill|0') && c.quests.has('af_woods|0'), 'side chains open');
    assert.ok(!c.quests.has('af_warren|0'), 'the Warren chain waits for Combat 12');
  } finally {
    done();
  }
});

test('a hero who finished hv_intro before Amberfold: af_intro waits at the Stones, no letter, travel still works', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Old');
    game.db.prepare("UPDATE quest_progress SET state = 'done' WHERE account_id = ? AND quest = 'hv_intro'").run(c.id);
    game.quests.load(c);
    game.quests.ensure(c);
    assert.equal(c.quests.get('af_intro|0')?.step, 0);
    assert.equal(game.heroes.count(c.id, 'letter_amberfold'), 0, 'no letter in Hearthvale');
  } finally {
    done();
  }
});

test('a meal with a buff can be eaten at full health; the Great Mill and the Elder Oak count when found', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Pip');
    game.heroes.addItem(c.id, 'hearthcap_pie', 1);
    c.ent.hp = c.ent.maxHp;
    const r = call(c, 'use', { item: 'hearthcap_pie' });
    assert.ok(r.ok, r.err);
    assert.equal(r.data.buff.slot, 'meal');
    for (const id of ['lm_great_mill', 'lm_elder_oak']) assert.ok(PACK.quests.some((q) => q.steps.some((st) => st.ev === 'discover' && st.match.id === id)), id);
  } finally {
    done();
  }
});
