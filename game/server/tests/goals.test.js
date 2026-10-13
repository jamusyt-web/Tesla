// The Compass (Phase 2, E2): never empty, the next-upgrade path, the
// card's 15-point rule and the context button's rule order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, nextUpgrades, planFor, pickShown, pickContext, CONTEXT_RULES, SWITCH_BY, bearing } from '../../shared/goals.js';
import { QUESTS } from '../../shared/quests.js';
import { ITEMS, STARTER_EQUIP, STARTER_INVENTORY } from '../../shared/items.js';
import { RECIPE_BY_ID } from '../../shared/recipes.js';
import { SKILL_IDS, xpForLevel } from '../../shared/skills.js';
import { mulberry32, LANDMARKS } from '../../shared/world.js';
import '../map.js'; // the world (with Hearthvale's landmarks)

const fresh = () => ({ skills: {}, level: 1, inv: { ...STARTER_INVENTORY }, equip: { ...STARTER_EQUIP }, pos: { x: 0, z: 8 }, region: 'hearthvale' });

test('never empty, across 1,000 random heroes', () => {
  const rng = mulberry32(7);
  const qids = Object.keys(QUESTS);
  const items = Object.keys(ITEMS);
  for (let k = 0; k < 1000; k++) {
    const hero = fresh();
    for (const s of SKILL_IDS) hero.skills[s] = xpForLevel(1 + Math.floor(rng() * 50));
    for (let i = 0; i < 6; i++) hero.inv[items[Math.floor(rng() * items.length)]] = Math.floor(rng() * 20);
    hero.pos = { x: (rng() - 0.5) * 190, z: (rng() - 0.5) * 190 };
    const quests = rng() < 0.5 ? [] : [{ id: qids[Math.floor(rng() * qids.length)], period: 0, step: 0, n: 0 }];
    const state = { hero, quests, journal: { found: new Set(rng() < 0.5 ? LANDMARKS.map((l) => l.id) : []), seen: new Set(), pages: [] }, unexplored: rng() < 0.5 ? { x: 10, z: 10 } : null, locate: () => (rng() < 0.7 ? { x: 0, z: 0 } : null) };
    const list = suggest(state);
    assert.ok(list.length > 0, `empty at ${k}`);
    assert.ok(list[0].text && list[0].src, 'the top goal has words');
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].score >= list[i].score, 'sorted');
  }
  assert.ok(suggest({}).length > 0, 'even with nothing at all');
});

test('a new hero: the intro leads, side chains and upgrades follow, places to find nearby', () => {
  const list = suggest({ hero: fresh(), quests: [{ id: 'hv_intro', period: 0, step: 0, n: 0 }, { id: 'hv_quarry', period: 0, step: 0, n: 0 }], journal: { found: new Set(), seen: new Set(), pages: [{ id: 'hearthvale', name: 'Hearthvale', pct: 4, places: 14, found: 1 }] } });
  assert.equal(list[0].id, 'hv_intro');
  assert.match(list[0].text, /Welcome to Hearthvale 1\/9: Chop an oak/);
  assert.ok(list.some((g) => g.src === 'upgrade'));
  assert.ok(list.some((g) => g.id === 'hv_quarry'));
});

test('the next upgrade walks the path back to a node you can work', () => {
  const hero = fresh();
  const up = nextUpgrades(hero);
  const pick = up.find((u) => u.slot === 'pick');
  assert.equal(pick.recipe.id, 'pick_copper');
  assert.match(pick.plan.text, /Copper Pickaxe: 3 Copper Bar → gather 6 Copper Ore/);
  assert.deepEqual(pick.plan.target, { kind: 'node', type: 'rock_copper' });
  // With the ore: smelt. With the bars and the planks: train, then forge.
  Object.assign(hero.inv, { copper_ore: 6, oak_log: 9 });
  hero.skills.crafting = xpForLevel(2);
  assert.match(planFor(hero, RECIPE_BY_ID.pick_copper).text, /make 3 Copper Bar at the Forge/i);
  hero.skills.crafting = xpForLevel(3);
  Object.assign(hero.inv, { copper_bar: 3, oak_plank: 2 });
  assert.match(planFor(hero, RECIPE_BY_ID.pick_copper).text, /Make a Copper Pickaxe at the Anvil/i);
  hero.skills.crafting = 0;
  assert.match(planFor(hero, RECIPE_BY_ID.pick_copper).text, /train Crafting to 3/);
  // Wearing it already: the next is iron, once it's within 3 Crafting levels.
  hero.equip.pick = 'pick_copper';
  assert.equal(nextUpgrades(hero).find((u) => u.slot === 'pick'), undefined);
  hero.skills.crafting = xpForLevel(3);
  assert.equal(nextUpgrades(hero).find((u) => u.slot === 'pick').recipe.id, 'pick_iron');
});

test('the card switches only when its goal is done or a rival is 15 points better', () => {
  const a = { id: 'a', score: 70 };
  const b = { id: 'b', score: 80 };
  const c = { id: 'c', score: 70 + SWITCH_BY };
  assert.equal(pickShown([b, a], 'a').id, 'a', '10 better: stay');
  assert.equal(pickShown([c, a], 'a').id, 'c', '15 better: switch');
  assert.equal(pickShown([b], 'a').id, 'b', 'done (gone): switch');
  assert.equal(pickShown([b, a], null).id, 'b');
});

test('the context button: first matching rule wins, in the spec’s order', () => {
  assert.deepEqual(CONTEXT_RULES, ['fight', 'elite', 'collect', 'deliver', 'passage', 'stone', 'door', 'landmark', 'craft', 'node', 'cast', 'monster', 'compass']);
  const r = (rule, d = 1) => ({ rule, d });
  assert.equal(pickContext([r('compass'), r('node'), r('landmark')]).rule, 'landmark');
  assert.equal(pickContext([r('monster'), r('fight', 15)]).rule, 'fight');
  assert.equal(pickContext([r('node', 9), r('node', 3)]).d, 3, 'nearest of the same rule');
  assert.equal(pickContext([]), null);
});

test('bearings read like a person would say them', () => {
  assert.equal(bearing({ x: 0, z: 0 }, { x: 0, z: -100 }), '100 m N');
  assert.equal(bearing({ x: 0, z: 0 }, { x: 70, z: 70 }), '100 m SE');
  assert.equal(bearing({ x: 0, z: 0 }, { x: 3, z: 3 }), 'right here');
});
