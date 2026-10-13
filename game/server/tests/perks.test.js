// Milestones and the level-40 choice (Phase 2, E6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONE_TEXT, unlocksAt, ladder, milestoneKeys } from '../../shared/milestones.js';
import { effectsOf, PICKS } from '../../shared/perks.js';
import { xpForLevel } from '../../shared/skills.js';
import { respecFee } from '../perks.js';
import { harness } from './harness.js';

test('every milestone with an effect has words, and every level-up lists something real', () => {
  for (const [skill, levels] of Object.entries(milestoneKeys())) for (const L of levels) assert.ok(MILESTONE_TEXT[skill]?.[L], `${skill} ${L}`);
  assert.ok(unlocksAt('foraging', 4).some((u) => /Birch/.test(u.text)), 'birch trees at Foraging 4');
  assert.ok(unlocksAt('crafting', 3).some((u) => u.recipe === 'pick_copper'));
  assert.ok(unlocksAt('combat', 40).some((u) => u.choose));
  for (const s of Object.keys(PICKS)) assert.ok(ladder(s).length >= 5, `${s} has a ladder`);
});

test('the respec price doubles up to its cap', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(respecFee), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
});

test('Grandmaster (50) grants both level-40 choices; 40 grants the one you picked', () => {
  const at = (lvl, pick) => effectsOf({ skills: { mining: xpForLevel(lvl) }, perks: pick ? { mining: pick } : {}, equip: {} });
  assert.equal(at(39, 'a').rockPower ?? 0, 0);
  assert.equal(at(40, 'a').rockPower, 1);
  assert.equal(at(40, 'a').bonusBar ?? 0, 0);
  assert.equal(at(50).rockPower, 1);
  assert.equal(at(50).bonusBar, 0.25);
});

test('choose once, then respec at a Town Hall for gold; level-ups send their unlocks', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Pika');
    assert.match(call(c, 'perks.choose', { skill: 'mining', pick: 'a' }).err, /Reach Mining 40/);
    game.heroes.addXp(c.hero, 'mining', xpForLevel(40));
    const u = c.sent.filter((m) => m.t === 'unlock' && m.skill === 'mining');
    assert.ok(u.length >= 5, 'every level crossed is listed');
    assert.ok(u.some((m) => m.lvl === 40 && m.list.some((x) => x.choose)));
    assert.ok(call(c, 'perks.choose', { skill: 'mining', pick: 'a' }).ok);
    assert.equal(c.effects().rockPower, 1);
    assert.match(call(c, 'perks.choose', { skill: 'mining', pick: 'b' }).err, /respec/);
    Object.assign(c.ent, { x: 60, z: 60 });
    assert.match(call(c, 'perks.respec', { skill: 'mining', pick: 'b' }).err, /Town Hall/);
    Object.assign(c.ent, { x: 16, z: 13 });
    game.heroes.addGold(c.id, 2000, 'test');
    const r = call(c, 'perks.respec', { skill: 'mining', pick: 'b' });
    assert.ok(r.ok, r.err);
    assert.equal(r.data.fee, 500);
    assert.equal(r.data.next, 1000);
    assert.equal(c.effects().bonusBar, 0.25);
    assert.equal(c.effects().rockPower ?? 0, 0);
    // Grandmaster: the title.
    game.heroes.addXp(c.hero, 'mining', xpForLevel(50));
    assert.ok(game.journal.get(c).titles.includes('Deepdelver'));
  } finally {
    done();
  }
});

test('Salvage (Crafting 10): half the bars back, at the anvil', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Sal');
    game.heroes.addItem(c.id, 'sword_copper', 1);
    assert.match(call(c, 'craft.salvage', { item: 'sword_copper' }).err, /Crafting 10/);
    game.heroes.addXp(c.hero, 'crafting', xpForLevel(10));
    c.fxChanged();
    Object.assign(c.ent, { x: 60, z: 60 });
    assert.match(call(c, 'craft.salvage', { item: 'sword_copper' }).err, /anvil/);
    Object.assign(c.ent, { x: -19, z: -10 });
    const r = call(c, 'craft.salvage', { item: 'sword_copper' });
    assert.ok(r.ok, r.err);
    assert.deepEqual(r.data.back, { copper_bar: 2 });
    assert.equal(game.heroes.count(c.id, 'sword_copper'), 0);
  } finally {
    done();
  }
});
