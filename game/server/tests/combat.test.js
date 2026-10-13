// Battle perks and elites (Phase 1, M4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../battle.js';
import { ITEMS } from '../../shared/items.js';
import { xpForLevel } from '../../shared/skills.js';
import { mobStats } from '../../shared/monsters.js';
import { harness } from './harness.js';

// A fight against a fresh slime in the hero's channel.
function fight(game, c, type = 'slime') {
  const mob = [...c.ch.mobs.values()].find((m) => m.type === type && m.state !== 'dead' && !m.battle);
  const b = new Battle(c.ch, mob);
  c.ch.battles.set(b.id, b);
  b.join(c);
  return b;
}
const wear = (game, c, slot, item) => {
  game.heroes.addItem(c.id, item, 1);
  game.heroes.setEquip(c.hero, slot, item);
  c.fxChanged();
};

test('specials: quick and fast specials charge sooner, never below 2', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Swift');
    let b = fight(game, c);
    assert.equal(b.fighters.get(c.id).need, 3);
    b.end(false);
    wear(game, c, 'weapon', 'wraith_blade');
    b = fight(game, c);
    assert.equal(b.fighters.get(c.id).need, 2);
    b.end(false);
    c.hero.buffs = {};
    c.fx = { at: Date.now(), E: { quickSpecial: 1, fastSpecial: 1 } };
    b = fight(game, c);
    assert.equal(b.fighters.get(c.id).need, 2, 'never below 2');
    b.end(false);
  } finally {
    done();
  }
});

test('thornguard sends damage back; frostbite chills; Second Stance charges twice', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Thorn');
    c.fx = { at: Date.now() + 1e9, E: { thornguard: 0.15, frostbite: 0.2, secondStance: 1 } };
    const b = fight(game, c, 'wolf');
    const f = b.fighters.get(c.id);
    f.hp = f.max = 10_000; // survive any roll
    b.mobHp = b.mobMax = 10_000;
    b.choose(c, 'defend');
    b.resolve();
    assert.equal(f.charge, 2, 'a defend counts double');
    assert.ok(b.mobHp < 10_000, 'the wolf hurt itself on the thorns');
    f.charge = f.need;
    b.choose(c, 'skill');
    b.resolve();
    assert.deepEqual(b.chill, { cut: 0.2, rounds: 1 }, 'the special chilled it (one round of the two gone)');
    b.end(false);
  } finally {
    done();
  }
});

test('mentor: a hero 8+ levels above lifts a newer hero’s combat xp; rally lifts both', () => {
  const { game, hero, done } = harness();
  try {
    const vet = hero('Vet');
    const kid = hero('Kid');
    Object.assign(kid.ent, { x: vet.ent.x, z: vet.ent.z });
    vet.hero.level = 20;
    vet.fx = { at: Date.now() + 1e9, E: { mentor: 0.2, rally: 0.05 } };
    const b = fight(game, kid);
    b.join(vet);
    assert.equal(b.fighters.get(vet.id).rally, 0.05, 'the one who joined');
    assert.equal(b.fighters.get(kid.id).rally, 0.05, 'and the friend already fighting');
    const xp0 = kid.hero.skills.combat || 0;
    b.mobHp = 1;
    b.choose(kid, 'attack');
    b.choose(vet, 'attack');
    b.resolve();
    const gained = (kid.hero.skills.combat || 0) - xp0;
    assert.equal(gained, Math.round(b.def.xp * 1.2));
  } finally {
    done();
  }
});

test('elites: a spawn flag restats its monster to its own level; hp grows as heroes join', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Hunter');
    const d = hero('Friend');
    const mob = [...c.ch.mobs.values()].find((m) => m.type === 'wolf' && !m.battle);
    mob.sp = { ...mob.sp, elite: true, lvl: 13, name: 'Mossjaw' };
    const one = c.ch.monsterDef(mob, 1);
    assert.deepEqual([one.name, one.hp, one.atk, one.lvl], ['Mossjaw', 687, 41, 13]);
    const b = new Battle(c.ch, mob);
    c.ch.battles.set(b.id, b);
    b.join(c);
    assert.equal(b.mobMax, 687);
    b.mobHp = 343; // half down
    Object.assign(d.ent, { x: c.ent.x, z: c.ent.z });
    b.join(d);
    assert.equal(b.mobMax, mobStats(13, 'elite', 2).hp);
    assert.ok(Math.abs(b.mobHp / b.mobMax - 0.5) < 0.01, 'keeps its wound');
    b.end(false);
  } finally {
    done();
  }
});
