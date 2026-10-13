// The content engine (Phase 1, M4): the monster curve, tools, item fields,
// buffs, perks and sets, the charm slot and gear requirements, and rich and
// ancient nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONSTERS, mobStats, eliteDef, heroStats } from '../../shared/monsters.js';
import { ITEMS, QUALITY_BASES, qualityId } from '../../shared/items.js';
import { SWING_FLOOR, SWING_GATE, NODE_TYPES } from '../../shared/world.js';
import { xpForLevel } from '../../shared/skills.js';
import { effectsOf, PICKS } from '../../shared/perks.js';
import { setBonuses } from '../../shared/sets.js';
import { applyBuff, useBuffs, activeBuffs } from '../../shared/buffs.js';
import { scheduled, tickNodeStates, STATE_FX, RICH_EVERY } from '../nodestates.js';
import { harness } from './harness.js';
import { hitNode } from '../gather.js';

// Hearthvale's monsters predate the curve and keep their numbers.
const GRANDFATHERED = new Set(['slime', 'wolf', 'goblin', 'golem', 'caterpillar', 'crab', 'ghost', 'boar', 'skeleton', 'thrall', 'crypt_skeleton', 'crypt_wisp', 'pale_count', 'bear']);

test('one curve: every new monster within ±15%; the golem check and the elite table', () => {
  for (const [id, m] of Object.entries(MONSTERS)) {
    if (GRANDFATHERED.has(id)) continue;
    const want = mobStats(m.lvl, m.boss ? (m.dungeon ? 'dboss' : 'boss') : 'normal');
    for (const k of ['hp', 'atk', 'xp']) assert.ok(Math.abs(m[k] / want[k] - 1) <= 0.15, `${id} ${k}: ${m[k]} vs ${want[k]}`);
  }
  assert.deepEqual(mobStats(11, 'boss'), { lvl: 11, hp: 424, atk: 34, def: 13, xp: 165, gold: [59, 93] }, 'the golem check');
  const golem = MONSTERS.golem;
  assert.ok(Math.abs(golem.hp / 424 - 1) < 0.15 && Math.abs(golem.atk / 34 - 1) < 0.15);
  // SPEC §4.2's elites: hp (1 fighter), atk, def, xp.
  for (const [L, hp, atk, def, xp] of [[13, 687, 41, 15, 267], [19, 1033, 59, 21, 447], [25, 1421, 77, 27, 663], [31, 1853, 95, 33, 915], [38, 2412, 116, 40, 1254]]) {
    const e = mobStats(L, 'elite');
    assert.deepEqual([e.hp, e.atk, e.def, e.xp], [hp, atk, def, xp], `elite L${L}`);
  }
  // An elite keeps its base model's moves and drops; its hp grows with each fighter.
  const e1 = eliteDef('wolf', 13, 1, 'Mossjaw');
  const e3 = eliteDef('wolf', 13, 3);
  assert.equal(e1.name, 'Mossjaw');
  assert.deepEqual(e1.moves, MONSTERS.wolf.moves);
  assert.equal(e3.hp, Math.round(687 / 2.4 * 2.4 * 2.2));
  assert.equal(e1.elite, true);
});

test('the tool speed floor: no tool (Fine or Masterwork) swings faster than 421 ms', () => {
  for (const it of Object.values(ITEMS).filter((i) => i.speed)) {
    assert.ok(it.speed > 421, `${it.name}: ${it.speed} ms`);
    assert.ok(SWING_FLOOR * it.speed < SWING_GATE * it.speed - 80, `${it.name}: jitter headroom`);
  }
});

test('item fields: every item has a tag; quality versions follow the rule', () => {
  const TAGS = new Set('wood plank ore bar herb fish food potion hide monster gem reagent tool gear kit charm trophy letter curio'.split(' '));
  for (const [id, it] of Object.entries(ITEMS)) assert.ok(TAGS.has(it.tag), `${id}: tag ${it.tag}`);
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.q) continue;
    const should = !it.set && it.tag !== 'kit' && it.tag !== 'charm' && (it.cat === 'tool' || ['weapon', 'armor', 'trinket'].includes(it.slot));
    if (should) assert.ok(QUALITY_BASES.includes(id) && ITEMS[qualityId(id, 2)], `${id} has Fine and Masterwork`);
  }
  assert.ok(!QUALITY_BASES.includes('charm_wayfarer'), 'no Masterwork charms');
  assert.ok(ITEMS['wraith_blade~master'], 'the barrow pieces keep theirs');
});

test('buffs count down only when you do the thing they help with', () => {
  let b = applyBuff({}, 'mint_tea', 0); // meal: +10% gathering xp, 40 gathers
  assert.equal(b.meal.left, 40);
  b = applyBuff(b, 'whetstone', 0); // tonic: power +1, 60 swings
  assert.equal(activeBuffs(b, 10 * 86400_000).meal.left, 40, 'days pass: nothing used up');
  let r = useBuffs(b, 'swing');
  assert.deepEqual([r.buffs.meal.left, r.buffs.tonic.left], [40, 59]);
  r = useBuffs(r.buffs, 'gather');
  assert.deepEqual([r.buffs.meal.left, r.buffs.tonic.left], [39, 59]);
  r = useBuffs(r.buffs, 'battle');
  assert.equal(r.changed, false, 'a battle uses neither');
  // Run one out; a new meal replaces the old.
  let x = r.buffs;
  for (let i = 0; i < 39; i++) x = useBuffs(x, 'gather').buffs;
  assert.equal(x.meal, undefined);
  assert.equal(applyBuff({ meal: { item: 'mint_tea', fx: {}, per: 'gather', left: 3 } }, 'mint_tea').meal.left, 40);
  // Timed buffs (travel) run on the clock.
  ITEMS.test_draught = { name: 'Test Draught', cat: 'consumable', tag: 'potion', value: 1, buff: { slot: 'tonic', fx: { moveSpeed: 0.1 }, uses: { ms: 1000 } } };
  try {
    const t = applyBuff({}, 'test_draught', 0);
    assert.ok(activeBuffs(t, 500).tonic && !activeBuffs(t, 1500).tonic);
  } finally {
    delete ITEMS.test_draught;
  }
});

test('perks and sets: gear, two and three pieces, milestones, level-40 choices, charms and buffs', () => {
  const hero = (equip = {}, skills = {}, perks = {}, buffs = {}) => ({ equip, skills, perks, buffs });
  assert.deepEqual(effectsOf(hero()), {});
  const two = { weapon: 'wraith_blade', armor: 'barrow_plate' };
  assert.equal(setBonuses(two).length, 1);
  const E2 = effectsOf(hero(two));
  assert.deepEqual([E2.quickSpecial, E2.setHp, E2.regenOut ?? 0], [1, 30, 0]);
  const E3 = effectsOf(hero({ ...two, trinket: 'ghostlight_amulet' }));
  assert.deepEqual([E3.setHp, E3.regenOut, E3.mender], [30, 2, 0.4]);
  // Stats: the set's hp counts; percentages lift attack.
  const s0 = heroStats(5, 5, [ITEMS.wraith_blade, ITEMS.barrow_plate]);
  const s1 = heroStats(5, 5, [ITEMS.wraith_blade, ITEMS.barrow_plate], E2);
  assert.equal(s1.hp, s0.hp + 30);
  assert.equal(heroStats(5, 5, [], { atkPct: 0.06 }).atk, Math.round(heroStats(5, 5, []).atk * 1.06));
  // Milestones come with skill levels.
  assert.equal(effectsOf(hero({}, { crafting: xpForLevel(4) })).steadyHands, undefined);
  assert.equal(effectsOf(hero({}, { crafting: xpForLevel(5) })).steadyHands, 1);
  assert.equal(effectsOf(hero({}, { fishing: xpForLevel(10) })).biteWindow, 100);
  // The level-40 choice (both at 50).
  assert.equal(effectsOf(hero({}, { foraging: xpForLevel(40) }, { foraging: 'a' })).treePower, 1);
  assert.equal(effectsOf(hero({}, { foraging: xpForLevel(39) }, { foraging: 'a' })).treePower, undefined);
  const both = effectsOf(hero({}, { combat: xpForLevel(50) }));
  assert.deepEqual([both.atkPct, both.defHpPct], [0.06, 0.06]);
  assert.ok(Object.keys(PICKS).length === 6);
  // A charm and a buff.
  assert.equal(effectsOf(hero({ charm: 'charm_wayfarer' })).moveSpeed, 0.08);
  assert.equal(effectsOf(hero({}, {}, {}, applyBuff({}, 'whetstone'))).toolPower, 1);
});

test('the charm slot, gear requirements, bound items and the use action', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Wear');
    assert.equal(c.hero.equip.charm, null, 'new heroes have an empty charm slot');
    game.heroes.addItem(c.id, 'charm_wayfarer', 1);
    assert.deepEqual(call(c, 'equip', { item: 'charm_wayfarer' }).data, { slot: 'charm' });
    assert.equal(c.ent.speedMul, 1.08, 'walks a little faster');
    // Gear with a Combat requirement.
    ITEMS.test_blade = { ...ITEMS.sword_iron, name: 'Test Blade', req: { combat: 12 } };
    try {
      game.heroes.addItem(c.id, 'test_blade', 1);
      assert.match(call(c, 'equip', { item: 'test_blade' }).err, /needs Combat level 12/);
      c.hero.skills.combat = xpForLevel(12);
      assert.ok(call(c, 'equip', { item: 'test_blade' }).ok);
    } finally {
      delete ITEMS.test_blade;
    }
    // Bound: never changes hands.
    game.heroes.addItem(c.id, 'trophy_hearthvale', 1);
    for (const [m, a] of [['market.place', { side: 'sell', item: 'trophy_hearthvale', price: 5, qty: 1 }], ['jobs.post', { item: 'trophy_hearthvale', qty: 1, per: 1 }], ['shop.stock', { slot: 0, item: 'trophy_hearthvale', qty: 1, price: 5 }]])
      assert.match(call(c, m, a).err, /can't change hands/, m);
    assert.match(call(c, 'npcSell', { item: 'trophy_hearthvale', qty: 1 }).err, /doesn't buy/);
    // Use: a meal starts its buff; a potion heals; drink still works.
    game.heroes.addItem(c.id, 'mint_tea', 1);
    const u = call(c, 'use', { item: 'mint_tea' }).data;
    assert.equal(u.buff.slot, 'meal');
    assert.equal(game.heroes.load(c.id).buffs.meal.left, 40, 'saved: it survives logging out');
    assert.equal(c.effects().gatherXp, 0.1);
    c.ent.hp = 10;
    assert.ok(call(c, 'use', { item: 'health_potion' }).data.heal > 0);
    c.ent.hp = 10;
    assert.ok(call(c, 'drink', { item: 'health_potion' }).ok);
    assert.match(call(c, 'use', { item: 'oak_log' }).err, /can't use/);
  } finally {
    done();
  }
});

test('rich and ancient nodes: one per region on the clock; a higher gate, more loot; spent when felled', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Rich');
    const ch = c.ch;
    // Find a moment when a rich node is up, then let the channel apply it.
    const now = Math.floor(Date.now() / RICH_EVERY) * RICH_EVERY + 1000;
    const want = scheduled(ch, now);
    assert.ok(want.size >= 1, 'something is rich in Hearthvale');
    ch.nsMinute = null;
    tickNodeStates(ch, now);
    const [id, w] = [...want.entries()][0];
    const n = ch.nodes.get(id);
    assert.equal(n.st, w.st);
    assert.ok(c.sent.some((m) => m.t === 'nst' && m.id === id));
    // An oak made rich: Foraging 9 to work it, three times the logs, 2.5× the xp.
    const oak = [...ch.nodes.values()].find((x) => x.type === 'tree_oak' && x.alive);
    Object.assign(oak, { st: 1, stKey: 'test:rich' });
    Object.assign(c.ent, { x: oak.x + 1.6, z: oak.z });
    assert.throws(() => hitNode(game, c, oak.id, Date.now()), /rich Oak Tree needs Foraging level 9/);
    c.hero.skills.foraging = xpForLevel(9);
    const xp0 = c.hero.skills.foraging;
    let t0 = Date.now();
    for (let k = 0; k < 40 && oak.alive; k++) hitNode(game, c, oak.id, (t0 += 1000));
    const loot = c.sent.filter((m) => m.t === 'loot' && m.node === oak.id).pop();
    assert.ok(loot.loot.oak_log >= 6, `rich yield: ${loot.loot.oak_log}`);
    assert.equal(c.hero.skills.foraging - xp0, Math.round(NODE_TYPES.tree_oak.xp * STATE_FX[1].xp));
    assert.equal(oak.st, 0, 'spent once it falls');
    assert.ok(ch.nsSpent.has('test:rich'), "and it won't turn again this time round");
  } finally {
    done();
  }
});

test('a whetstone wears on tool swings, not herbs; a Keeper standing near regrows nodes sooner', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Sage');
    const ch = c.ch;
    c.hero.buffs = applyBuff({}, 'whetstone');
    c.fxChanged();
    const herbs = [...ch.nodes.values()].filter((n) => n.type === 'herb_mint' && n.alive && !n.st);
    const [h1, h2] = herbs;
    let now = Date.now();
    Object.assign(c.ent, { x: h1.x, z: h1.z, path: null });
    hitNode(game, c, h1.id, now);
    assert.equal(c.hero.buffs.tonic.left, 60, 'picking a herb leaves the whetstone alone');
    assert.equal(h1.alive, false);
    assert.equal(h1.respawnAt, now + NODE_TYPES.herb_mint.respawn * 1000, 'no Keeper near: the usual wait');
    // A Herb Keeper standing by, not picking: the next one regrows a quarter sooner.
    const k = hero('Keep');
    assert.equal(k.ch, ch);
    k.fx = { at: Date.now() + 1e9, E: { auraRegrowHerb: 0.25 } };
    Object.assign(k.ent, { x: h2.x + 5, z: h2.z, path: null });
    Object.assign(c.ent, { x: h2.x, z: h2.z, path: null });
    hitNode(game, c, h2.id, (now += 5000));
    assert.equal(h2.respawnAt, now + NODE_TYPES.herb_mint.respawn * 1000 * 0.75);
    // A tree swing does wear it.
    const oak = [...ch.nodes.values()].find((x) => x.type === 'tree_oak' && x.alive && !x.st);
    Object.assign(c.ent, { x: oak.x + 1.6, z: oak.z });
    hitNode(game, c, oak.id, (now += 5000));
    assert.equal(c.hero.buffs.tonic.left, 59);
  } finally {
    done();
  }
});
