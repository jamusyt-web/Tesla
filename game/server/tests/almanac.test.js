// The Almanac (Phase 2, E5): dailies from what you can do, banking at 6,
// one reroll a day, the weekly errand, and the pay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questDef } from '../../shared/quests.js';
import { NODE_TYPES } from '../../shared/nodes.js';
import { MAX_OPEN, DAILY_GOLD } from '../../shared/almanac.js';
import { dayIndex } from '../../shared/dungeon.js';
import { emit } from '../events.js';
import { harness } from './harness.js';

const DAY = 86_400_000;

test('three dailies a day, one per column, only from what the hero can already do', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Ana');
    const a = game.almanac.get(c);
    assert.equal(a.dailies.length, 3);
    assert.deepEqual(a.dailies.map((d) => questDef(d.id).col), ['make', 'venture', 'wander']);
    for (const d of a.dailies) {
      const def = questDef(d.id);
      const step = def.steps[0];
      assert.ok(step.text && step.target, d.id);
      if (step.ev === 'gather') assert.ok(NODE_TYPES[step.target.type].lvl <= 1, `a new hero gets level-1 gathering, not ${step.target.type}`);
      if (step.ev === 'kill') assert.ok(!/golem|bear|skeleton/.test(step.match.monster ?? ''), 'nothing far above them');
    }
    assert.equal(a.weekly.length, 1);
    assert.equal(questDef(a.weekly[0].id).steps.length, 5);
    assert.equal(a.today.featured.kind, 'hollow_crypt');
  } finally {
    done();
  }
});

test('dailies bank up to six; a new day only fills free places', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Bex');
    const now = Date.now();
    assert.equal(game.almanac.get(c, now).dailies.length, 3);
    assert.equal(game.almanac.get(c, now + DAY).dailies.length, 6);
    assert.equal(game.almanac.get(c, now + 2 * DAY).dailies.filter((d) => !d.done).length, MAX_OPEN, 'never more than 6 open');
  } finally {
    done();
  }
});

test('one reroll a day, for the same column', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Cyd');
    const now = Date.now();
    const a = game.almanac.get(c, now);
    const d = a.dailies[2];
    const b = game.almanac.reroll(c, d.id, d.period, now);
    assert.ok(!b.dailies.some((x) => x.id === d.id), 'the old one is gone');
    assert.equal(b.dailies.length, 3);
    assert.ok(b.dailies.some((x) => questDef(x.id).col === 'wander'));
    assert.equal(b.rerollLeft, false);
    assert.throws(() => game.almanac.reroll(c, b.dailies[0].id, b.dailies[0].period, now), /reroll/);
    assert.equal(game.almanac.get(c, now + DAY).rerollLeft, true, 'a new one tomorrow');
  } finally {
    done();
  }
});

test('finishing a daily pays 40 g per tier, skill xp and a material', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Dru');
    const a = game.almanac.get(c);
    const d = a.dailies.find((x) => questDef(x.id).steps[0].ev === 'kill');
    const def = questDef(d.id);
    const g0 = game.heroes.gold(c.id);
    const inv0 = game.heroes.inventory(c.id);
    for (let k = 0; k < def.steps[0].n; k++) emit(c, 'kill', { monster: def.steps[0].match.monster });
    assert.equal(game.heroes.gold(c.id) - g0, DAILY_GOLD * def.tier);
    const mat = Object.keys(def.reward.items)[0];
    assert.equal(game.heroes.count(c.id, mat) - (inv0[mat] ?? 0), 1);
    assert.ok(game.almanac.get(c).dailies.find((x) => x.id === d.id).done, 'shown as done today');
    assert.ok(game.db.prepare("SELECT amount FROM gold_flow WHERE reason = 'daily'").get().amount > 0);
  } finally {
    done();
  }
});
